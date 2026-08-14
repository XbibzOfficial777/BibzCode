import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Bot, Play, RotateCcw, Send, Square, X } from 'lucide-react';
import { friendlyError } from '../lib';

const shortcuts = ['/provider', '/model', '/key', '/tools', '/mcp', '/session', '/compact', '/context', '/telegram', '/discord'];

export function AssistantPanel({ visible, root, startSignal, stopSignal, onClose, onError, onNeedsRuntime }: {
  visible: boolean; root: string; startSignal: number; stopSignal: number; onClose: () => void; onError: (message: string) => void; onNeedsRuntime: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [state, setState] = useState<'stopped' | 'starting' | 'running'>('stopped');

  useEffect(() => {
    if (!host.current || terminal.current) return;
    const instance = new Terminal({ convertEol: true, cursorBlink: false, disableStdin: true, fontSize: 13, fontFamily: "'JetBrains Mono', 'Cascadia Mono', monospace", theme: { background: '#080808', foreground: '#e4e4e4', cursor: '#fff', black: '#080808', brightBlack: '#707070', white: '#ddd', brightWhite: '#fff' }, scrollback: 20_000 });
    const fit = new FitAddon(); instance.loadAddon(fit); instance.open(host.current); instance.writeln('\x1b[1;37mBibzCode Assistant\x1b[0m'); instance.writeln('Full CLI providers, tools, MCP, sessions, connectors and approvals are available here.');
    terminal.current = instance;
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } }); observer.observe(host.current);
    const offData = window.bibzIDE.cli.onData((event) => instance.write(event.data));
    const offExit = window.bibzIDE.cli.onExit((event) => { instance.writeln(`\r\n\x1b[90m[BibzCode exited ${event.code ?? event.signal ?? 'unknown'}]\x1b[0m`); setSessionId(''); setState('stopped'); });
    return () => { offData(); offExit(); observer.disconnect(); instance.dispose(); terminal.current = null; };
  }, []);

  const start = useCallback(async () => {
    if (!root) { onError('Open a workspace before starting BibzCode.'); return; }
    setState('starting'); terminal.current?.writeln('\r\n\x1b[90mStarting canonical BibzCode runtime…\x1b[0m');
    try { const id = await window.bibzIDE.cli.start(); setSessionId(id); setState('running'); }
    catch (error) { setState('stopped'); const message = friendlyError(error); onError(message); if (/runtime|dependencies|python/i.test(message)) onNeedsRuntime(); }
  }, [onError, onNeedsRuntime, root]);
  const stop = useCallback(async () => { if (sessionId) await window.bibzIDE.cli.stop(sessionId); }, [sessionId]);
  useEffect(() => {
    // External menu signal intentionally bridges into the assistant process lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (startSignal > 0) void start();
  }, [start, startSignal]);
  useEffect(() => { if (stopSignal > 0) void stop(); }, [stop, stopSignal]);
  const send = async (value = input) => {
    if (!value.trim()) return;
    if (!sessionId) { onError('Start the BibzCode assistant first.'); return; }
    try { await window.bibzIDE.cli.input(sessionId, `${value.trim()}\n`); setInput(''); }
    catch (error) { onError(friendlyError(error)); }
  };
  if (!visible) return null;
  return <aside className="assistant-panel">
    <div className="assistant-heading"><div><Bot /><strong>BIBZCODE</strong><span className={`status-dot ${state}`} /> </div><div><button className="icon-button" title="Start/restart" onClick={() => void start()}>{state === 'stopped' ? <Play /> : <RotateCcw />}</button><button className="icon-button" title="Stop" disabled={!sessionId} onClick={() => void stop()}><Square /></button><button className="icon-button" title="Close" onClick={onClose}><X /></button></div></div>
    <div className="assistant-shortcuts">{shortcuts.map((command) => <button key={command} onClick={() => void send(command)}>{command}</button>)}</div>
    <div className="assistant-terminal" ref={host} />
    <form className="assistant-input" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={state === 'running' ? 'Message or slash command…' : 'Start BibzCode to begin…'} rows={3} /><button title="Send" disabled={!sessionId || !input.trim()}><Send /></button></form>
    <div className="assistant-foot">Local approval and security policy remain enforced by the canonical CLI runtime.</div>
  </aside>;
}
