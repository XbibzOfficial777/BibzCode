import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type AgentStreamEvent, type ExitEvent, type ProcessEvent } from '../shared/contracts.js';

const on = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

const api = {
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo),
    openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.appOpenExternal, url),
    checkForUpdates: () => ipcRenderer.invoke(CHANNELS.updateCheck),
  },
  workspace: {
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent),
    select: () => ipcRenderer.invoke(CHANNELS.workspaceSelect),
    list: (relative = '') => ipcRenderer.invoke(CHANNELS.workspaceList, relative),
    search: (query: string) => ipcRenderer.invoke(CHANNELS.workspaceSearch, query),
    onChanged: (listener: (root: string) => void) => on(CHANNELS.workspaceChanged, listener),
  },
  file: {
    read: (relative: string) => ipcRenderer.invoke(CHANNELS.fileRead, relative),
    write: (relative: string, content: string) => ipcRenderer.invoke(CHANNELS.fileWrite, relative, content),
    create: (relative: string, kind: 'file' | 'directory') => ipcRenderer.invoke(CHANNELS.fileCreate, relative, kind),
    rename: (from: string, to: string) => ipcRenderer.invoke(CHANNELS.fileRename, from, to),
    trash: (relative: string) => ipcRenderer.invoke(CHANNELS.fileTrash, relative),
  },
  terminal: {
    run: (command: string) => ipcRenderer.invoke(CHANNELS.terminalRun, { command }),
    stop: (sessionId: string) => ipcRenderer.invoke(CHANNELS.terminalStop, sessionId),
    onData: (listener: (event: ProcessEvent) => void) => on(CHANNELS.terminalData, listener),
    onExit: (listener: (event: ExitEvent) => void) => on(CHANNELS.terminalExit, listener),
  },
  cli: {
    start: () => ipcRenderer.invoke(CHANNELS.cliStart),
    input: (sessionId: string, data: string) => ipcRenderer.invoke(CHANNELS.cliInput, { sessionId, data }),
    stop: (sessionId: string) => ipcRenderer.invoke(CHANNELS.cliStop, sessionId),
    onData: (listener: (event: ProcessEvent) => void) => on(CHANNELS.cliData, listener),
    onExit: (listener: (event: ExitEvent) => void) => on(CHANNELS.cliExit, listener),
  },
  runtime: {
    status: () => ipcRenderer.invoke(CHANNELS.runtimeStatus),
    setup: (full: boolean) => ipcRenderer.invoke(CHANNELS.runtimeSetup, { full }),
    onData: (listener: (event: ProcessEvent) => void) => on(CHANNELS.runtimeData, listener),
    onExit: (listener: (event: ExitEvent) => void) => on(CHANNELS.runtimeExit, listener),
  },
  git: {
    status: () => ipcRenderer.invoke(CHANNELS.gitStatus),
    diff: (relativePath = '', staged = false) => ipcRenderer.invoke(CHANNELS.gitDiff, { relativePath, staged }),
    stage: (relativePath: string) => ipcRenderer.invoke(CHANNELS.gitStage, relativePath),
    unstage: (relativePath: string) => ipcRenderer.invoke(CHANNELS.gitUnstage, relativePath),
    commit: (message: string) => ipcRenderer.invoke(CHANNELS.gitCommit, message),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
  },
  secrets: {
    status: () => ipcRenderer.invoke(CHANNELS.secretStatus) as Promise<{ configured: boolean }>,
    set: (value: string) => ipcRenderer.invoke(CHANNELS.secretSet, { name: 'ai-api-key', value }) as Promise<{ configured: boolean }>,
    clear: () => ipcRenderer.invoke(CHANNELS.secretClear, { name: 'ai-api-key' }) as Promise<{ configured: boolean }>,
  },
  agent: {
    probe: () => ipcRenderer.invoke(CHANNELS.agentProbe),
    models: () => ipcRenderer.invoke(CHANNELS.agentModels),
    complete: (prompt: string, systemPrompt?: string) => ipcRenderer.invoke(CHANNELS.agentComplete, { prompt, systemPrompt }),
    streamStart: (requestId: string, prompt: string, systemPrompt?: string) => ipcRenderer.invoke(CHANNELS.agentStreamStart, { requestId, request: { prompt, systemPrompt } }),
    onStream: (listener: (event: AgentStreamEvent) => void) => on(CHANNELS.agentStreamEvent, listener),
    streamCancel: (requestId: string) => ipcRenderer.invoke(CHANNELS.agentStreamCancel, requestId),
    compress: (text: string, targetChars: number) => ipcRenderer.invoke(CHANNELS.compressionTest, { text, targetChars }),
  },
  menu: {
    onCommand: (listener: (command: string) => void) => on(CHANNELS.menuCommand, listener),
  },
};

contextBridge.exposeInMainWorld('bibzIDE', Object.freeze(api));
