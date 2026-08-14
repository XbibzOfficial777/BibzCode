import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Play, Square, Trash2, X } from 'lucide-react';
import { friendlyError } from '../lib';

export function TerminalPanel({ visible, onClose, onError }: { visible: boolean; onClose: () => void; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [command, setCommand] = useState('');
  const [activeId, setActiveId] = useState('');
  const [cwd, setCwd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    if (!host.current || terminal.current) return;
    const instance = new Terminal({ convertEol: true, cursorBlink: false, disableStdin: true, fontSize: 13, fontFamily: "'JetBrains Mono', 'Cascadia Mono', monospace", theme: { background: '#070707', foreground: '#dedede', cursor: '#ffffff', black: '#090909', brightBlack: '#6b6b6b', white: '#d4d4d4', brightWhite: '#ffffff' }, scrollback: 10_000 });
    const fit = new FitAddon();
    instance.loadAddon(fit); instance.open(host.current); instance.writeln('\x1b[1;37mBibzCode IDE Terminal\x1b[0m'); instance.writeln('Commands run inside the active workspace.');
    terminal.current = instance;
    const observer = new ResizeObserver(() => { try { fit.fit(); } catch { /* panel may be hidden */ } });
    observer.observe(host.current);
    const offData = window.bibzIDE.terminal.onData((event) => instance.write(event.data));
    const offExit = window.bibzIDE.terminal.onExit((event) => { instance.writeln(`\r\n\x1b[90m[process exited ${event.code ?? event.signal ?? 'unknown'}]\x1b[0m`); setActiveId((id) => id === event.sessionId ? '' : id); });
    return () => { offData(); offExit(); observer.disconnect(); instance.dispose(); terminal.current = null; };
  }, []);

  const run = async () => {
    const value = command.trim(); if (!value) return;
    terminal.current?.writeln(`\r\n\x1b[1;37m❯\x1b[0m ${value}`);
    setHistory((items) => [...items.filter((item) => item !== value), value].slice(-100)); setHistoryIndex(-1); setCommand('');
    try { const result = await window.bibzIDE.terminal.run(value); setActiveId(result.sessionId); setCwd(result.cwd); }
    catch (error) { onError(friendlyError(error)); }
  };
  const navigateHistory = (direction: number) => {
    if (!history.length) return;
    const next = Math.max(-1, Math.min(history.length - 1, historyIndex + direction));
    setHistoryIndex(next); setCommand(next < 0 ? '' : history[history.length - 1 - next]);
  };
  if (!visible) return null;
  return <section className="terminal-panel">
    <div className="panel-heading"><strong>TERMINAL</strong><span className="panel-path" title={cwd}>{cwd}</span><div><button className="icon-button" title="Clear" onClick={() => terminal.current?.clear()}><Trash2 /></button><button className="icon-button" title="Stop" disabled={!activeId} onClick={() => activeId && void window.bibzIDE.terminal.stop(activeId)}><Square /></button><button className="icon-button" title="Close" onClick={onClose}><X /></button></div></div>
    <div className="terminal-host" ref={host} />
    <form className="terminal-input" onSubmit={(event) => { event.preventDefault(); void run(); }}><span>❯</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowUp') { event.preventDefault(); navigateHistory(1); } if (event.key === 'ArrowDown') { event.preventDefault(); navigateHistory(-1); } }} placeholder="Run a command in this workspace" autoComplete="off" /><button title="Run"><Play /></button></form>
  </section>;
}
