import { useEffect, useRef, useState } from 'react';
import { Bot, Check, LoaderCircle, Square, X, XCircle } from 'lucide-react';
import { friendlyError } from '../lib';

type PendingApproval = { requestId: string; callId: string; tool: string; risk?: string; arguments?: Record<string, unknown> };

export function AgentPromptModal({ open, activeFile, onClose, onError }: { open: boolean; activeFile?: { relativePath: string; content: string }; onClose: () => void; onError: (message: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [activity, setActivity] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [running, setRunning] = useState(false);
  const requestId = useRef('');

  useEffect(() => window.bibzIDE.agent.onStream((event) => {
    if (event.requestId !== requestId.current) return;
    if (event.type === 'start') { setRunning(true); setResult(''); setActivity([]); }
    if (event.type === 'delta') setResult((value) => value + (event.delta ?? ''));
    if (event.type === 'tool_call' && event.tool) setActivity((items) => [...items, `Calling ${event.tool}…`]);
    if (event.type === 'tool_result' && event.tool) setActivity((items) => [...items, `${event.tool}: ${event.result?.slice(0, 240) ?? 'completed'}`]);
    if (event.type === 'approval_request' && event.callId && event.tool) setPending({ requestId: event.requestId, callId: event.callId, tool: event.tool, risk: event.risk, arguments: event.arguments });
    if (event.type === 'done') { setResult(event.text ?? ''); setPending(null); setRunning(false); }
    if (event.type === 'error') { setPending(null); setRunning(false); onError(event.message ?? 'Agent task failed.'); }
  }), [onError]);

  const cancel = async () => {
    if (!requestId.current || !running) return;
    try { await window.bibzIDE.agent.streamCancel(requestId.current); } catch (error) { onError(friendlyError(error)); }
    setPending(null); setRunning(false);
  };
  const approve = async (approved: boolean) => {
    if (!pending) return;
    try { await window.bibzIDE.agent.approve(pending.requestId, pending.callId, approved); setPending(null); }
    catch (error) { onError(friendlyError(error)); }
  };
  const run = async () => {
    if (!prompt.trim() || running) return;
    const id = crypto.randomUUID(); requestId.current = id; setResult(''); setActivity([]); setPending(null); setRunning(true);
    try {
      const context = activeFile ? `\n\nActive file: ${activeFile.relativePath}\n\n${activeFile.content}` : '';
      await window.bibzIDE.agent.streamStart(id, `${prompt.trim()}${context}`, 'You are the native BibzCode Agent Manager. Use tools to inspect, implement, verify, and report exact artifacts. Request approval before protected actions.');
    } catch (error) { setRunning(false); onError(friendlyError(error)); }
  };
  const close = () => { void cancel(); onClose(); };

  return open ? <div className="modal-backdrop" onMouseDown={close}><section className="agent-modal" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><Bot /><div><h2>Agent Task</h2><p>Plan, tool calls, approvals, artifacts, and verification through the native IDE.</p></div></div><button className="icon-button" onClick={close} title="Close"><X /></button></header>
    <label>Task<textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void run(); }} placeholder="Implement, debug, review, test, or explain…" rows={5} /></label>
    {activeFile && <div className="agent-context">Context: <strong>{activeFile.relativePath}</strong> ({activeFile.content.length.toLocaleString()} chars)</div>}
    {activity.length > 0 && <div className="agent-modal-activity">{activity.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}</div>}
    {(result || running) && <pre className="agent-result" aria-live="polite">{result || 'Agent is planning…'}</pre>}
    {pending && <div className="agent-approval"><strong>Approval required for {pending.tool}</strong><span>{pending.risk ?? 'protected'} action</span><pre>{JSON.stringify(pending.arguments ?? {}, null, 2)}</pre><div><button className="secondary-button" onClick={() => void approve(false)}><XCircle /> Deny</button><button className="primary-button" onClick={() => void approve(true)}><Check /> Approve</button></div></div>}
    <footer><span><kbd>Ctrl</kbd><kbd>Enter</kbd> run</span><div className="agent-actions">{running && <button className="secondary-button" onClick={() => void cancel()}><Square /> Stop</button>}<button className="primary-button" onClick={() => void run()} disabled={running || !prompt.trim()}>{running ? <><LoaderCircle className="spin" /> Working…</> : result ? <><Check /> Run again</> : <><Bot /> Start agent</>}</button></div></footer>
  </section></div> : null;
}
