import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Boxes, Files, FolderOpen, GitBranch, Search, Settings, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react';
import type { ActivityView, AppInfo, IdeSettings, OpenFile } from '../shared/contracts';
import { AssistantPanel } from './components/AssistantPanel';
import { AgentPromptModal } from './components/AgentPromptModal';
import { EditorArea } from './components/EditorArea';
import { Explorer } from './components/Explorer';
import { SearchView } from './components/SearchView';
import { SettingsPanel } from './components/SettingsPanel';
import { SourceControl } from './components/SourceControl';
import { TerminalPanel } from './components/TerminalPanel';
import { ToolsView } from './components/ToolsView';
import { friendlyError, languageForPath } from './lib';
import logo from './assets/logo.png';

interface PaletteCommand { id: string; label: string; shortcut?: string; run: () => void }

export function App() {
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [activity, setActivity] = useState<ActivityView>('explorer');
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [targetLine, setTargetLine] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [assistantVisible, setAssistantVisible] = useState(true);
  const [assistantStart, setAssistantStart] = useState(0);
  const [assistantStop, setAssistantStop] = useState(0);
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [toast, setToast] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast((value) => value === message ? '' : value), 5500); }, []);
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    void window.bibzIDE.workspace.current().then(setWorkspaceRoot);
    void window.bibzIDE.settings.get().then(setSettings);
    void window.bibzIDE.app.info().then(setAppInfo);
    const off = window.bibzIDE.workspace.onChanged((root) => { setWorkspaceRoot(root); setOpenFiles([]); setActivePath(''); refresh(); });
    return off;
  }, [refresh]);

  useEffect(() => { document.title = workspaceRoot ? `${workspaceRoot.split(/[\\/]/).pop()} — BibzCode IDE` : 'BibzCode IDE'; }, [workspaceRoot]);

  const openFolder = useCallback(async () => {
    try { const root = await window.bibzIDE.workspace.select(); if (root) { setWorkspaceRoot(root); refresh(); } }
    catch (error) { notify(friendlyError(error)); }
  }, [notify, refresh]);

  const openFile = useCallback(async (relativePath: string, line = 0) => {
    const existing = openFiles.find((file) => file.relativePath === relativePath);
    if (existing) { setActivePath(relativePath); setTargetLine(line); return; }
    try {
      const content = await window.bibzIDE.file.read(relativePath);
      setOpenFiles((files) => [...files, { relativePath, content, language: languageForPath(relativePath), dirty: false }]);
      setActivePath(relativePath); setTargetLine(line);
    } catch (error) { notify(friendlyError(error)); }
  }, [notify, openFiles]);

  const openVirtual = useCallback((label: string, content: string) => {
    const relativePath = `virtual://diff/${label}`;
    setOpenFiles((files) => [...files.filter((file) => file.relativePath !== relativePath), { relativePath, content: content || 'No diff output.', language: 'diff', dirty: false }]);
    setActivePath(relativePath); setTargetLine(0);
  }, []);

  const saveActive = useCallback(async () => {
    const active = openFiles.find((file) => file.relativePath === activePath);
    if (!active || !active.dirty || active.relativePath.startsWith('virtual://')) return;
    try {
      await window.bibzIDE.file.write(active.relativePath, active.content);
      setOpenFiles((files) => files.map((file) => file.relativePath === active.relativePath ? { ...file, dirty: false } : file));
      refresh(); notify(`Saved ${active.relativePath}`);
    } catch (error) { notify(friendlyError(error)); }
  }, [activePath, notify, openFiles, refresh]);

  const closeFile = useCallback((relativePath: string) => {
    const target = openFiles.find((file) => file.relativePath === relativePath);
    if (target?.dirty && !confirm(`Discard unsaved changes in ${relativePath}?`)) return;
    const index = openFiles.findIndex((file) => file.relativePath === relativePath);
    const remaining = openFiles.filter((file) => file.relativePath !== relativePath);
    setOpenFiles(remaining);
    if (activePath === relativePath) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.relativePath ?? '');
  }, [activePath, openFiles]);

  const startAssistant = useCallback(() => { setAssistantVisible(true); setAssistantStart((value) => value + 1); }, []);
  const checkUpdates = useCallback(async () => {
    try { const result = await window.bibzIDE.app.checkForUpdates(); notify(result.message + (result.version ? ` ${result.version}` : '')); }
    catch (error) { notify(friendlyError(error)); }
  }, [notify]);

  const commands = useMemo<PaletteCommand[]>(() => [
    { id: 'open-folder', label: 'File: Open Folder…', shortcut: 'Ctrl+K Ctrl+O', run: () => void openFolder() },
    { id: 'save', label: 'File: Save Active File', shortcut: 'Ctrl+S', run: () => void saveActive() },
    { id: 'view-explorer', label: 'View: Explorer', shortcut: 'Ctrl+Shift+E', run: () => setActivity('explorer') },
    { id: 'view-search', label: 'View: Search', shortcut: 'Ctrl+Shift+F', run: () => setActivity('search') },
    { id: 'view-source-control', label: 'View: Source Control', shortcut: 'Ctrl+Shift+G', run: () => setActivity('source-control') },
    { id: 'focus-terminal', label: 'View: Toggle Terminal', shortcut: 'Ctrl+`', run: () => setTerminalVisible((value) => !value) },
    { id: 'start-assistant', label: 'BibzCode: Open Native AI Assistant', shortcut: 'Ctrl+Shift+B', run: startAssistant },
    { id: 'agent-prompt', label: 'BibzCode: Run Agent Prompt', shortcut: 'Ctrl+Shift+I', run: () => setAgentOpen(true) },
    { id: 'stop-assistant', label: 'BibzCode: Stop Assistant', run: () => setAssistantStop((value) => value + 1) },
    { id: 'features', label: 'BibzCode: Show Feature Parity', run: () => setActivity('tools') },
    { id: 'settings', label: 'Preferences: Open Settings', run: () => setActivity('settings') },
    { id: 'check-updates', label: 'Application: Check for Updates…', run: () => void checkUpdates() },
  ], [checkUpdates, openFolder, saveActive, startAssistant]);

  useEffect(() => window.bibzIDE.menu.onCommand((command) => {
    if (command === 'command-palette') { setPaletteOpen(true); return; }
    if (command === 'new-file') { setActivity('explorer'); window.setTimeout(() => notify('Use the New File button in Explorer.'), 50); return; }
    if (command === 'close-editor') { if (activePath) closeFile(activePath); return; }
    if (command === 'clear-terminal') { setTerminalVisible(false); window.setTimeout(() => setTerminalVisible(true), 0); return; }
    if (command === 'stop-terminal') { notify('Use the stop button beside the active terminal command.'); return; }
    commands.find((item) => item.id === command)?.run();
  }), [activePath, closeFile, commands, notify]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void saveActive(); }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setPaletteOpen(true); }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'i') { event.preventDefault(); setAgentOpen(true); }
      if (event.key === 'Escape') { setPaletteOpen(false); setAgentOpen(false); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [saveActive]);

  const sideContent = (() => {
    if (activity === 'explorer') return <Explorer root={workspaceRoot} refreshToken={refreshToken} onOpen={(path) => void openFile(path)} onError={notify} onRefresh={refresh} />;
    if (activity === 'search') return <SearchView root={workspaceRoot} onOpen={(path, line) => void openFile(path, line)} onError={notify} />;
    if (activity === 'source-control') return <SourceControl root={workspaceRoot} refreshToken={refreshToken} onDiff={openVirtual} onError={notify} onRefresh={refresh} />;
    if (activity === 'tools') return <ToolsView onStartAssistant={startAssistant} />;
    return <SettingsPanel onError={notify} />;
  })();

  const filteredCommands = commands.filter((command) => command.label.toLowerCase().includes(paletteQuery.toLowerCase()));
  const runCommand = (command: PaletteCommand) => { setPaletteOpen(false); setPaletteQuery(''); command.run(); };

  const themeClass = settings?.theme === 'high-contrast' ? 'high-contrast' : settings?.theme === 'bibz-light' ? 'light-theme' : '';
  return <div className={`app ${themeClass}`}>
    <header className="titlebar"><div className="brand"><img src={logo} alt="" /><span>BibzCode IDE</span><small>{appInfo?.version ?? '7.8.0-r6'}</small></div><div className="title-workspace">{workspaceRoot || 'No workspace open'}</div><div className="title-actions"><button onClick={() => void openFolder()}><FolderOpen /> Open Folder</button><button onClick={startAssistant}><Sparkles /> BibzCode</button></div></header>
    <div className="workbench">
      <nav className="activity-bar" aria-label="Activity bar">
        {([
          ['explorer', Files, 'Explorer'], ['search', Search, 'Search'], ['source-control', GitBranch, 'Source Control'], ['tools', Boxes, 'Feature Parity'], ['settings', Settings, 'Settings'],
        ] as const).map(([view, Icon, label]) => <button key={view} className={activity === view ? 'active' : ''} onClick={() => setActivity(view)} title={label}><Icon /><span>{label}</span></button>)}
        <div className="activity-spacer" />
        <button className={assistantVisible ? 'active' : ''} title="BibzCode Assistant" onClick={() => setAssistantVisible((value) => !value)}><Bot /><span>Assistant</span></button>
      </nav>
      <aside className="sidebar">{sideContent}</aside>
      <div className="center-column">
        <EditorArea files={openFiles} activePath={activePath} settings={settings} targetLine={targetLine} onActivate={(path) => { setActivePath(path); setTargetLine(0); }} onChange={(path, content) => setOpenFiles((files) => files.map((file) => file.relativePath === path ? { ...file, content, dirty: true } : file))} onClose={closeFile} onSave={() => void saveActive()} onCursor={(line, column) => setCursor({ line, column })} />
        <TerminalPanel visible={terminalVisible} onClose={() => setTerminalVisible(false)} onError={notify} />
      </div>
      <AssistantPanel visible={assistantVisible} activeFile={openFiles.find((file) => file.relativePath === activePath)} startSignal={assistantStart} stopSignal={assistantStop} onClose={() => setAssistantVisible(false)} onError={notify} />
    </div>
      <footer className="statusbar"><button onClick={() => setActivity('source-control')}><GitBranch /> source control</button><span><ShieldCheck /> native security policy</span><span className="status-spacer" /><span className="ai-status"><Sparkles /> {settings?.aiProvider ?? 'AI'} · {settings?.aiModel ?? 'Configure provider'}</span><button onClick={() => setTerminalVisible((value) => !value)}><TerminalSquare /> Terminal</button><span>Ln {cursor.line}, Col {cursor.column}</span></footer>
    {paletteOpen && <div className="palette-backdrop" onMouseDown={() => setPaletteOpen(false)}><section className="command-palette" onMouseDown={(event) => event.stopPropagation()}><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type a command" /><div>{filteredCommands.map((command) => <button key={command.id} onClick={() => runCommand(command)}><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>)}</div></section></div>}
    <AgentPromptModal open={agentOpen} activeFile={openFiles.find((file) => file.relativePath === activePath)} onClose={() => setAgentOpen(false)} onError={notify} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
