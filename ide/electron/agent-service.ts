import type { AgentCompletionRequest, CompressionResult, IdeSettings, ProviderProbe } from '../shared/contracts.js';
import { SecretStore } from './secret-store.js';
import { cleanAssistantText } from './response-cleaner.js';

interface OpenAiChunk { choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; message?: { content?: string }; text?: string }> }
interface AnthropicChunk { type?: string; delta?: { type?: string; text?: string; thinking?: string }; content_block?: { text?: string } }
interface GoogleChunk { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }

export class AgentService {
  constructor(private readonly secrets: SecretStore, private readonly getSettings: () => IdeSettings) {}
  private config(): IdeSettings { return this.getSettings(); }
  private apiKey(): string { return this.secrets.get('ai-api-key') || process.env.BIBZCODE_API_KEY || ''; }
  private endpoint(path: string): string { return `${this.config().aiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`; }
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const config = this.config(); const key = this.apiKey();
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (key && config.aiProvider === 'anthropic') headers['x-api-key'] = key;
    else if (key && config.aiProvider !== 'google') headers.Authorization = `Bearer ${key}`;
    return headers;
  }
  private async responseError(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    return body.slice(0, 600) || response.statusText || `HTTP ${response.status}`;
  }

  async testConnection(): Promise<ProviderProbe> {
    const started = Date.now(); const config = this.config();
    try {
      const url = config.aiProvider === 'google' ? `${this.endpoint('/models')}?key=${encodeURIComponent(this.apiKey())}` : this.endpoint('/models');
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(12_000) });
      return { ok: response.ok, status: response.status, message: response.ok ? 'Provider reachable and credentials accepted.' : await this.responseError(response), latencyMs: Date.now() - started };
    } catch (error) { return { ok: false, status: 0, message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started }; }
  }

  async listModels(): Promise<string[]> {
    const config = this.config(); const url = config.aiProvider === 'google' ? `${this.endpoint('/models')}?key=${encodeURIComponent(this.apiKey())}` : this.endpoint('/models');
    const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Model discovery failed: ${await this.responseError(response)}`);
    const payload = await response.json() as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> };
    return (payload.data ?? payload.models ?? []).map((model) => (model.id ?? model.name ?? '').replace(/^models\//, '')).filter(Boolean).sort();
  }

  private async *sseData(response: Response): AsyncGenerator<string> {
    if (!response.body) throw new Error('Provider returned an empty streaming body.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const emit = (event: string): string | null => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n').trim();
      return data && data !== '[DONE]' ? data : null;
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? '';
      for (const event of events) { const data = emit(event); if (data) yield data; }
      if (done) break;
    }
    const data = emit(buffer); if (data) yield data;
  }

  private async *openAiCompatible(request: AgentCompletionRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const config = this.config(); const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const system = request.systemPrompt || 'You are BibzCode Agent. Be precise, preserve code semantics, and return actionable edits.';
    const thinking = config.thinkingEnabled && config.thinkingMode !== 'off';
    const response = await fetch(this.endpoint('/chat/completions'), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }), signal, body: JSON.stringify({ model: config.aiModel, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], ...(thinking ? { reasoning_effort: config.thinkingMode === 'deep' ? 'high' : config.thinkingMode === 'fast' ? 'low' : 'medium', max_completion_tokens: config.thinkingBudget } : {}) }) });
    if (!response.ok) throw new Error(`Provider request failed: ${await this.responseError(response)}`);
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const payload = await response.json() as OpenAiChunk; const text = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text ?? ''; if (text) yield text; return;
    }
    for await (const data of this.sseData(response)) {
      const chunk = JSON.parse(data) as OpenAiChunk; const text = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? chunk.choices?.[0]?.text ?? '';
      if (text) yield text;
    }
  }

  private async *anthropic(request: AgentCompletionRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const config = this.config(); const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const thinking = config.thinkingEnabled && config.thinkingMode !== 'off';
    const response = await fetch(this.endpoint('/messages'), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }), signal, body: JSON.stringify({ model: config.aiModel, max_tokens: Math.max(1024, config.thinkingBudget), system: request.systemPrompt || 'You are BibzCode Agent. Be precise and preserve code semantics.', messages: [{ role: 'user', content: prompt }], stream: true, ...(thinking ? { thinking: { type: 'enabled', budget_tokens: config.thinkingBudget } } : {}) }) });
    if (!response.ok) throw new Error(`Anthropic request failed: ${await this.responseError(response)}`);
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const payload = await response.json() as { content?: Array<{ text?: string }> }; const text = payload.content?.map((part) => part.text ?? '').join('') ?? ''; if (text) yield text; return;
    }
    for await (const data of this.sseData(response)) { const chunk = JSON.parse(data) as AnthropicChunk; const text = chunk.delta?.text ?? (chunk.type === 'content_block_start' ? chunk.content_block?.text ?? '' : ''); if (text) yield text; }
  }

  private async *google(request: AgentCompletionRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const config = this.config(); const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const url = `${this.endpoint(`/models/${encodeURIComponent(config.aiModel)}:streamGenerateContent`)}?alt=sse&key=${encodeURIComponent(this.apiKey())}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${request.systemPrompt || 'You are BibzCode Agent. Be precise and preserve code semantics.'}\n\n${prompt}` }] }], generationConfig: config.thinkingEnabled && config.thinkingMode !== 'off' ? { thinkingConfig: { thinkingBudget: config.thinkingBudget } } : {} }) });
    if (!response.ok) throw new Error(`Google request failed: ${await this.responseError(response)}`);
    for await (const data of this.sseData(response)) { const chunk = JSON.parse(data) as GoogleChunk; const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''; if (text) yield text; }
  }

  async *streamCompletion(request: AgentCompletionRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const config = this.config();
    if (config.aiProvider === 'anthropic') yield* this.anthropic(request, signal);
    else if (config.aiProvider === 'google') yield* this.google(request, signal);
    else yield* this.openAiCompatible(request, signal);
  }

  async complete(request: AgentCompletionRequest): Promise<string> {
    let output = ''; for await (const delta of this.streamCompletion(request)) output += delta; return cleanAssistantText(output);
  }

  compressContext(input: string, targetChars: number): CompressionResult {
    const originalChars = input.length; const limit = Math.max(2048, targetChars);
    if (originalChars <= limit || this.config().compressionMode === 'off') return { text: input, originalChars, compressedChars: originalChars, ratio: 1, preservedBlocks: 0 };
    const lines = input.split(/\r?\n/); const blocks: Array<{ text: string; score: number; index: number; code: boolean }> = []; let code = false; let buffer: string[] = [];
    const flush = (index: number): void => { if (!buffer.length) return; const text = buffer.join('\n'); const score = (code && this.config().compressionPreserveCode ? 100 : 0) + (/(error|exception|stack trace|diagnostic|failed|warning)/i.test(text) ? 80 : 0) + (/^\s*(diff --git|@@|#|##|###|function |class |export |import )/m.test(text) ? 45 : 0) + Math.min(20, Math.floor(text.length / 400)); blocks.push({ text, score, index, code }); buffer = []; };
    lines.forEach((line, index) => { if (line.trim().startsWith('```')) { buffer.push(line); if (code) flush(index); code = !code; if (!code) buffer = []; return; } buffer.push(line); if (!code && buffer.length >= 8) flush(index); }); flush(lines.length);
    let used = 0; let preservedBlocks = 0; const selected = blocks.sort((a, b) => b.score - a.score || b.index - a.index); const output: string[] = [];
    for (const block of selected) { if (used + block.text.length + 2 > limit) continue; output.push(block.text); used += block.text.length + 2; if ((block.code && this.config().compressionPreserveCode) || block.score >= 80) preservedBlocks++; }
    const text = output.length ? `${output.reverse().join('\n\n')}\n\n[ BibzCode Ultra Compression: omitted low-priority context ]` : input.slice(0, limit);
    return { text, originalChars, compressedChars: text.length, ratio: text.length / Math.max(1, originalChars), preservedBlocks };
  }
}
