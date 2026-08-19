import { useEffect, useRef, useState } from 'react';
import { Bot, Check, LoaderCircle, Square, X } from 'lucide-react';
import { friendlyError } from '../lib';

export function AgentPromptModal({ open, activeFile, onClose, onError }: { open: boolean; activeFile?: { relativePath: string; content: string }; onClose: () => void; onError: (message: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const requestId = useRef('');

  useEffect(() => window.bibzIDE.agent.onStream((event) => {
    if (event.requestId !== requestId.current) return;
    if (event.type === 'start') { setResult(''); setRunning(true); }
    if (event.type === 'delta') setResult((value) => value + (event.delta ?? ''));
    if (event.type === 'done') { setResult(event.text ?? ''); setRunning(false); }
    if (event.type === 'error') { setRunning(false); onError(event.message ?? 'Agent streaming failed.'); }
  }), [onError]);

  const cancel = async () => {
    if (!requestId.current || !running) return;
    try { await window.bibzIDE.agent.streamCancel(requestId.current); } catch (error) { onError(friendlyError(error)); }
    setRunning(false);
  };

  const run = async () => {
    if (!prompt.trim() || running) return;
    const id = crypto.randomUUID(); requestId.current = id; setResult(''); setRunning(true);
    try {
      const context = activeFile ? `\n\nActive file: ${activeFile.relativePath}\n\n${activeFile.content}` : '';
      await window.bibzIDE.agent.streamStart(id, `${prompt.trim()}${context}`, 'You are the native BibzCode Agent. Analyze the supplied code context and provide a concise, safe, actionable response. Never claim an edit was applied unless the user applies it.');
    } catch (error) { setRunning(false); onError(friendlyError(error)); }
  };

  const close = () => { void cancel(); onClose(); };
  return open ? <div className="modal-backdrop" onMouseDown={close}><section className="agent-modal" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><Bot /><div><h2>Run Agent Prompt</h2><p>Streaming provider response with deterministic context compression and noise cleanup.</p></div></div><button className="icon-button" onClick={close} title="Close"><X /></button></header>
    <label>Prompt<textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void run(); }} placeholder="Explain, refactor, debug, or review the active file…" rows={5} /></label>
    {activeFile && <div className="agent-context">Context: <strong>{activeFile.relativePath}</strong> ({activeFile.content.length.toLocaleString()} chars)</div>}
    {(result || running) && <pre className="agent-result" aria-live="polite">{result || 'Connecting to provider…'}</pre>}
    <footer><span><kbd>Ctrl</kbd><kbd>Enter</kbd> run</span><div className="agent-actions">{running && <button className="secondary-button" onClick={() => void cancel()}><Square /> Stop</button>}<button className="primary-button" onClick={() => void run()} disabled={running || !prompt.trim()}>{running ? <><LoaderCircle className="spin" /> Streaming…</> : result ? <><Check /> Run again</> : <><Bot /> Run agent</>}</button></div></footer>
  </section></div> : null;
}
