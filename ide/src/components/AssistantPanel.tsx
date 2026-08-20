import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, CircleDot, RotateCcw, Send, Square, X, XCircle } from 'lucide-react';
import { friendlyError } from '../lib';

type AssistantMessage = { role: 'user' | 'assistant'; text: string };
type AgentActivity = { callId: string; tool: string; risk?: string; status: 'running' | 'waiting' | 'approved' | 'denied' | 'done' | 'failed'; detail?: string };
type PendingApproval = { requestId: string; callId: string; tool: string; risk?: string; arguments?: Record<string, unknown> };

const shortcuts = ['Inspect active file', 'Review for bugs', 'Implement tests', 'Run verification'];

export function AssistantPanel({ visible, startSignal, stopSignal, activeFile, onClose, onError }: {
  visible: boolean;
  startSignal: number;
  stopSignal: number;
  activeFile?: { relativePath: string; content: string };
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [state, setState] = useState<'ready' | 'streaming' | 'stopped'>('ready');
  const requestId = useRef('');
  const outputRef = useRef('');

  useEffect(() => window.bibzIDE.agent.onStream((event) => {
    if (event.requestId !== requestId.current) return;
    if (event.type === 'start') { outputRef.current = ''; setState('streaming'); }
    if (event.type === 'delta') {
      outputRef.current += event.delta ?? '';
      setMessages((items) => items.map((item, index) => index === items.length - 1 && item.role === 'assistant' ? { ...item, text: outputRef.current } : item));
    }
    if (event.type === 'tool_call' && event.callId && event.tool) {
      setActivities((items) => [...items, { callId: event.callId!, tool: event.tool!, risk: event.risk, status: 'running', detail: JSON.stringify(event.arguments ?? {}) }]);
    }
    if (event.type === 'approval_request' && event.callId && event.tool) {
      setPendingApproval({ requestId: event.requestId, callId: event.callId, tool: event.tool, risk: event.risk, arguments: event.arguments });
      setActivities((items) => items.map((item) => item.callId === event.callId ? { ...item, status: 'waiting' } : item));
    }
    if (event.type === 'tool_result' && event.callId) {
      setActivities((items) => items.map((item) => item.callId === event.callId ? { ...item, status: 'done', detail: event.result } : item));
    }
    if (event.type === 'done') {
      outputRef.current = event.text ?? outputRef.current;
      setMessages((items) => items.map((item, index) => index === items.length - 1 && item.role === 'assistant' ? { ...item, text: outputRef.current } : item));
      setPendingApproval(null); setState('ready');
    }
    if (event.type === 'error') { setState('ready'); setPendingApproval(null); onError(event.message ?? 'Agent task failed.'); }
  }), [onError]);

  useEffect(() => {
    // The native menu signal intentionally resets the agent lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (startSignal > 0) setState('ready');
  }, [startSignal]);

  const stop = useCallback(async () => {
    if (!requestId.current || state !== 'streaming') return;
    try { await window.bibzIDE.agent.streamCancel(requestId.current); } catch (error) { onError(friendlyError(error)); }
    setPendingApproval(null); setState('stopped');
  }, [onError, state]);

  useEffect(() => { if (stopSignal > 0) void stop(); }, [stop, stopSignal]);

  const approve = async (approved: boolean) => {
    if (!pendingApproval) return;
    try {
      await window.bibzIDE.agent.approve(pendingApproval.requestId, pendingApproval.callId, approved);
      setActivities((items) => items.map((item) => item.callId === pendingApproval.callId ? { ...item, status: approved ? 'approved' : 'denied' } : item));
      setPendingApproval(null);
    } catch (error) { onError(friendlyError(error)); }
  };

  const send = async (value = input) => {
    if (!value.trim() || state === 'streaming') return;
    const prompt = value.trim(); setInput('');
    const context = activeFile ? `\n\nActive file: ${activeFile.relativePath}\n\n${activeFile.content}` : '';
    const id = crypto.randomUUID(); requestId.current = id; outputRef.current = '';
    setActivities([]); setPendingApproval(null); setMessages((items) => [...items, { role: 'user', text: prompt }, { role: 'assistant', text: '' }]); setState('streaming');
    try { await window.bibzIDE.agent.streamStart(id, `${prompt}${context}`, 'You are the BibzCode Agent Manager. Break the task into verifiable steps, use tools when they add value, inspect results, request approval for writes/terminal/Git actions, and report exactly what changed.'); }
    catch (error) { setState('ready'); setMessages((items) => items.slice(0, -2)); onError(friendlyError(error)); }
  };

  if (!visible) return null;
  return <aside className="assistant-panel">
    <div className="assistant-heading"><div><Bot /><strong>AGENT MANAGER</strong><span className={`status-dot ${state}`} /></div><div><button className="icon-button" title="Reset task view" onClick={() => { setMessages([]); setActivities([]); setPendingApproval(null); setState('ready'); }}><RotateCcw /></button><button className="icon-button" title="Stop agent" disabled={state !== 'streaming'} onClick={() => void stop()}><Square /></button><button className="icon-button" title="Close" onClick={onClose}><X /></button></div></div>
    <div className="assistant-shortcuts">{shortcuts.map((command) => <button key={command} onClick={() => void send(command)} disabled={state === 'streaming'}>{command}</button>)}</div>
    <div className="agent-task-label"><CircleDot /> {state === 'streaming' ? 'Working on task' : state === 'stopped' ? 'Task stopped' : 'Ready for a task'}</div>
    <div className="assistant-messages" aria-live="polite">{messages.length === 0 && <div className="assistant-empty">Describe an engineering task. The Agent Manager can inspect your workspace, use tools, make approved changes, run verification, and show reviewable results.</div>}{messages.map((message, index) => <article key={`${message.role}-${index}`} className={`assistant-message ${message.role}`}><span>{message.role === 'user' ? 'Task' : 'Agent result'}</span><pre>{message.text || (message.role === 'assistant' && state === 'streaming' ? 'Planning and streaming…' : '')}</pre></article>)}{activities.length > 0 && <section className="agent-activity"><strong>Task activity</strong>{activities.map((activity) => <article className={`agent-activity-item ${activity.status}`} key={activity.callId}><div><span className="activity-tool">{activity.tool}</span><span className="activity-status">{activity.status}</span></div>{activity.detail && <pre>{activity.detail}</pre>}</article>)}</section>}</div>
    {pendingApproval && <div className="agent-approval"><strong>Approval required</strong><span><code>{pendingApproval.tool}</code> wants to perform a {pendingApproval.risk ?? 'protected'} action.</span><pre>{JSON.stringify(pendingApproval.arguments ?? {}, null, 2)}</pre><div><button className="secondary-button" onClick={() => void approve(false)}><XCircle /> Deny</button><button className="primary-button" onClick={() => void approve(true)}><Check /> Approve</button></div></div>}
    <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={state === 'streaming' ? 'Agent is working…' : 'Describe a task for the Agent Manager…'} rows={3} /><button title="Send task" disabled={state === 'streaming' || !input.trim()}><Send /></button></form>
    <div className="assistant-foot">Agent tools · approvals · artifacts · native provider streaming</div>
  </aside>;
}
