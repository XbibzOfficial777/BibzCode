import type { AgentCompletionRequest, CompressionResult, IdeSettings, ProviderProbe } from '../shared/contracts.js';
import type { AgentToolName } from '../shared/agent-tools.js';
import { ToolExecutor } from './tool-executor.js';
import { SecretStore } from './secret-store.js';
import { cleanAssistantText } from './response-cleaner.js';

interface OpenAiToolCall { id: string; type: 'function'; function: { name: AgentToolName; arguments: string } }
interface OpenAiChunk { choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }> }; message?: { content?: string; tool_calls?: OpenAiToolCall[] }; text?: string }> }
interface AgentToolCall { id: string; name: AgentToolName; arguments: Record<string, unknown> }
function deniedByPolicy(request: AgentCompletionRequest, tool: AgentToolName): boolean { return request.allowMutations === false && ['workspace_write', 'workspace_create', 'workspace_rename', 'workspace_trash', 'terminal_run', 'git_stage', 'git_unstage', 'git_commit'].includes(tool); }
export type ToolAgentEvent =
  | { type: 'delta'; delta: string }
  | { type: 'tool_call'; callId: string; tool: AgentToolName; arguments: Record<string, unknown>; risk: 'read' | 'write' | 'terminal' | 'git' }
  | { type: 'tool_result'; callId: string; tool: AgentToolName; result: string; risk: 'read' | 'write' | 'terminal' | 'git' }
  | { type: 'approval_request'; callId: string; tool: AgentToolName; arguments: Record<string, unknown>; risk: 'read' | 'write' | 'terminal' | 'git' };
interface AnthropicChunk { type?: string; index?: number; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }; content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string } }
interface GoogleChunk { candidates?: Array<{ content?: { role?: string; parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> }; functionResponse?: { name?: string; response?: Record<string, unknown> } }> } }> }

export class AgentService {
  constructor(private readonly secrets: SecretStore, private readonly getSettings: () => IdeSettings, private readonly tools: ToolExecutor) {}
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

  private openAiTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.tools.definitions().map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  }

  private parseToolArguments(value: string): Record<string, unknown> {
    try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
    catch { return {}; }
  }

  private anthropicTools(): Array<Record<string, unknown>> { return this.tools.definitions().map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })); }

  private googleSchema(value: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = { ...value }; if (typeof output.type === 'string') output.type = output.type.toUpperCase();
    if (output.properties && typeof output.properties === 'object') output.properties = Object.fromEntries(Object.entries(output.properties as Record<string, unknown>).map(([key, child]) => [key, this.googleSchema(child as Record<string, unknown>)]));
    return output;
  }

  private googleTools(): Array<Record<string, unknown>> { return [{ functionDeclarations: this.tools.definitions().map((tool) => ({ name: tool.name, description: tool.description, parameters: this.googleSchema(tool.parameters) })) }]; }

  private async *anthropicAgent(request: AgentCompletionRequest, signal: AbortSignal, approve: (call: AgentToolCall, risk: 'read' | 'write' | 'terminal' | 'git') => Promise<boolean>): AsyncGenerator<ToolAgentEvent> {
    const config = this.config(); const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
    for (let step = 0; step < 12; step += 1) {
      const response = await fetch(this.endpoint('/messages'), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', 'anthropic-version': '2023-06-01' }), signal, body: JSON.stringify({ model: config.aiModel, max_tokens: Math.max(1024, config.thinkingBudget), system: request.systemPrompt || 'You are the BibzCode Agent Manager. Plan, use tools, verify, and report artifacts.', messages, tools: this.anthropicTools(), stream: true }) });
      if (!response.ok) throw new Error(`Anthropic agent request failed: ${await this.responseError(response)}`);
      let text = ''; const calls = new Map<number, { id: string; name: string; arguments: string }>();
      if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        for await (const data of this.sseData(response)) {
          const chunk = JSON.parse(data) as AnthropicChunk;
          if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') calls.set(chunk.index ?? calls.size, { id: chunk.content_block.id ?? `call_${calls.size}`, name: chunk.content_block.name ?? '', arguments: JSON.stringify(chunk.content_block.input ?? {}) });
          if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta' && chunk.delta.text) { text += chunk.delta.text; yield { type: 'delta', delta: chunk.delta.text }; }
          if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta' && chunk.delta.partial_json && calls.size) { const last = [...calls.keys()].at(-1)!; calls.get(last)!.arguments += chunk.delta.partial_json; }
        }
      } else {
        const payload = await response.json() as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
        const blocks = payload.content ?? []; text = blocks.filter((block) => block.type === 'text').map((block) => block.text ?? '').join(''); if (text) yield { type: 'delta', delta: text };
        blocks.filter((block) => block.type === 'tool_use').forEach((block, index) => calls.set(index, { id: block.id ?? `call_${index}`, name: block.name ?? '', arguments: JSON.stringify(block.input ?? {}) }));
      }
      if (!calls.size) return;
      const parsedCalls = [...calls.values()].filter((call) => this.tools.has(call.name)).map((call) => ({ id: call.id, name: call.name as AgentToolName, arguments: this.parseToolArguments(call.arguments) }));
      messages.push({ role: 'assistant', content: [{ type: 'text', text }, ...parsedCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }))] });
      for (const call of parsedCalls) {
        const definition = this.tools.definitions().find((tool) => tool.name === call.name)!; yield { type: 'tool_call', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk };
        let result = 'Tool call denied by policy.';
        if (!deniedByPolicy(request, call.name) && (!this.tools.requiresApproval(call.name) || (yield { type: 'approval_request', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk }, await approve(call, definition.risk)))) result = (await this.tools.execute(call.name, call.arguments, request.requestId)).output;
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: result }] }); yield { type: 'tool_result', callId: call.id, tool: call.name, result, risk: definition.risk };
      }
    }
    throw new Error('Agent reached the maximum of 12 tool steps.');
  }

  private async *googleAgent(request: AgentCompletionRequest, signal: AbortSignal, approve: (call: AgentToolCall, risk: 'read' | 'write' | 'terminal' | 'git') => Promise<boolean>): AsyncGenerator<ToolAgentEvent> {
    const config = this.config(); const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const contents: Array<Record<string, unknown>> = [{ role: 'user', parts: [{ text: `${request.systemPrompt || 'You are the BibzCode Agent Manager. Plan, use tools, verify, and report artifacts.'}\\n\\n${prompt}` }] }];
    for (let step = 0; step < 12; step += 1) {
      const url = `${this.endpoint(`/models/${encodeURIComponent(config.aiModel)}:streamGenerateContent`)}?alt=sse&key=${encodeURIComponent(this.apiKey())}`;
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal, body: JSON.stringify({ contents, tools: this.googleTools(), toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }) });
      if (!response.ok) throw new Error(`Google agent request failed: ${await this.responseError(response)}`);
      let text = ''; const calls: AgentToolCall[] = [];
      for await (const data of this.sseData(response)) {
        const chunk = JSON.parse(data) as GoogleChunk; const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) { text += part.text; yield { type: 'delta', delta: part.text }; }
          if (part.functionCall?.name) calls.push({ id: `google_${step}_${calls.length}`, name: part.functionCall.name as AgentToolName, arguments: part.functionCall.args ?? {} });
        }
      }
      if (!calls.length) return;
      contents.push({ role: 'model', parts: [{ ...(text ? { text } : {}) }, ...calls.map((call) => ({ functionCall: { name: call.name, args: call.arguments } }))] });
      for (const call of calls) {
        if (!this.tools.has(call.name)) throw new Error(`Google requested unknown agent tool: ${call.name}`);
        const definition = this.tools.definitions().find((tool) => tool.name === call.name)!; yield { type: 'tool_call', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk };
        let result = 'Tool call denied by policy.';
        if (!deniedByPolicy(request, call.name) && (!this.tools.requiresApproval(call.name) || (yield { type: 'approval_request', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk }, await approve(call, definition.risk)))) result = (await this.tools.execute(call.name, call.arguments, request.requestId)).output;
        contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: { result } } }] });
        yield { type: 'tool_result', callId: call.id, tool: call.name, result, risk: definition.risk };
      }
    }
    throw new Error('Agent reached the maximum of 12 tool steps.');
  }

  async *streamAgent(request: AgentCompletionRequest, signal: AbortSignal, approve: (call: AgentToolCall, risk: 'read' | 'write' | 'terminal' | 'git') => Promise<boolean>): AsyncGenerator<ToolAgentEvent> {
    const config = this.config();
    if (config.aiProvider === 'anthropic') yield* this.anthropicAgent(request, signal, approve);
    else if (config.aiProvider === 'google') yield* this.googleAgent(request, signal, approve);
    else {
    const prompt = this.compressContext(request.prompt, Math.max(2048, config.compressionContextWindow * 4)).text;
    const system = request.systemPrompt || 'You are BibzCode Agent. Plan carefully, use workspace tools when needed, verify changes, and report concise actionable results.';
    const messages: Array<Record<string, unknown>> = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    for (let step = 0; step < 12; step += 1) {
      const response = await fetch(this.endpoint('/chat/completions'), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }), signal, body: JSON.stringify({ model: config.aiModel, stream: true, messages, tools: this.openAiTools(), tool_choice: 'auto', ...(config.thinkingEnabled && config.thinkingMode !== 'off' ? { reasoning_effort: config.thinkingMode === 'deep' ? 'high' : config.thinkingMode === 'fast' ? 'low' : 'medium', max_completion_tokens: config.thinkingBudget } : {}) }) });
      if (!response.ok) throw new Error(`Agent provider request failed: ${await this.responseError(response)}`);
      let content = ''; const calls = new Map<number, { id: string; name: string; arguments: string }>();
      if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        for await (const data of this.sseData(response)) {
          const chunk = JSON.parse(data) as OpenAiChunk; const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) { content += delta.content; yield { type: 'delta', delta: delta.content }; }
          for (const fragment of delta?.tool_calls ?? []) {
            const index = fragment.index ?? 0; const current = calls.get(index) ?? { id: fragment.id ?? `call_${index}`, name: '', arguments: '' };
            if (fragment.id) current.id = fragment.id; if (fragment.function?.name) current.name += fragment.function.name; if (fragment.function?.arguments) current.arguments += fragment.function.arguments; calls.set(index, current);
          }
        }
      } else {
        const payload = await response.json() as OpenAiChunk; const message = payload.choices?.[0]?.message; content = message?.content ?? '';
        if (content) yield { type: 'delta', delta: content };
        for (const call of message?.tool_calls ?? []) calls.set(calls.size, { id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
      if (!calls.size) return;
      const parsedCalls: AgentToolCall[] = [...calls.values()].filter((call) => this.tools.has(call.name)).map((call) => ({ id: call.id, name: call.name as AgentToolName, arguments: this.parseToolArguments(call.arguments) }));
      if (!parsedCalls.length) throw new Error('The provider requested an unknown agent tool.');
      messages.push({ role: 'assistant', content: content || null, tool_calls: parsedCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
      for (const call of parsedCalls) {
        const definition = this.tools.definitions().find((tool) => tool.name === call.name);
        if (!definition) continue;
        yield { type: 'tool_call', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk };
        if (deniedByPolicy(request, call.name)) {
          const denied = 'Tool call denied by orchestration policy.'; messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: denied }); yield { type: 'tool_result', callId: call.id, tool: call.name, result: denied, risk: definition.risk }; continue;
        }
        if (this.tools.requiresApproval(call.name)) {
          yield { type: 'approval_request', callId: call.id, tool: call.name, arguments: call.arguments, risk: definition.risk };
          if (!await approve(call, definition.risk)) {
            const denied = 'Tool call denied by the user.'; messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: denied }); yield { type: 'tool_result', callId: call.id, tool: call.name, result: denied, risk: definition.risk }; continue;
          }
        }
        const result = await this.tools.execute(call.name, call.arguments, request.requestId); messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result.output }); yield { type: 'tool_result', callId: call.id, tool: call.name, result: result.output, risk: definition.risk };
      }
    }
    throw new Error('Agent reached the maximum of 12 tool steps.');
    }
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
