import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type AgentArtifact, type AgentOrchestrationEvent, type AgentStreamEvent, type ExtensionGalleryItem, type ExtensionRuntimeEvent, type ExtensionRuntimeStatus, type ExitEvent, type InstalledExtension, type ProcessEvent } from '../shared/contracts.js';

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
  extensions: {
    search: (query: string, registry: 'open-vsx' | 'vscode-marketplace') => ipcRenderer.invoke(CHANNELS.extensionSearch, { query, registry }) as Promise<ExtensionGalleryItem[]>,
    installed: () => ipcRenderer.invoke(CHANNELS.extensionInstalled) as Promise<InstalledExtension[]>,
    install: (item: ExtensionGalleryItem) => ipcRenderer.invoke(CHANNELS.extensionInstall, item) as Promise<InstalledExtension>,
    installVsix: () => ipcRenderer.invoke(CHANNELS.extensionInstallVsix) as Promise<InstalledExtension | null>,
    uninstall: (id: string) => ipcRenderer.invoke(CHANNELS.extensionUninstall, id) as Promise<void>,
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(CHANNELS.extensionSetEnabled, { id, enabled }) as Promise<InstalledExtension>,
    setTrust: (id: string, trust: 'trusted' | 'untrusted') => ipcRenderer.invoke(CHANNELS.extensionSetTrust, { id, trust }) as Promise<InstalledExtension>,
    runtimeStart: (id: string) => ipcRenderer.invoke(CHANNELS.extensionRuntimeStart, id) as Promise<ExtensionRuntimeStatus>,
    runtimeStop: (id: string) => ipcRenderer.invoke(CHANNELS.extensionRuntimeStop, id) as Promise<void>,
    runtimeStatus: () => ipcRenderer.invoke(CHANNELS.extensionRuntimeStatus) as Promise<ExtensionRuntimeStatus[]>,
    runtimeCommand: (id: string, command: string, args: unknown[] = []) => ipcRenderer.invoke(CHANNELS.extensionRuntimeCommand, { id, command, arguments: args }) as Promise<void>,
    onRuntimeEvent: (listener: (event: ExtensionRuntimeEvent) => void) => on(CHANNELS.extensionRuntimeEvent, listener),
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
    approve: (requestId: string, callId: string, approved: boolean) => ipcRenderer.invoke(CHANNELS.agentApprove, { requestId, callId, approved }),
    compress: (text: string, targetChars: number) => ipcRenderer.invoke(CHANNELS.compressionTest, { text, targetChars }),
    artifacts: (requestId?: string) => ipcRenderer.invoke(CHANNELS.artifactList, requestId) as Promise<AgentArtifact[]>,
    keepArtifact: (id: string) => ipcRenderer.invoke(CHANNELS.artifactKeep, id) as Promise<AgentArtifact>,
    rejectArtifact: (id: string) => ipcRenderer.invoke(CHANNELS.artifactReject, id) as Promise<AgentArtifact>,
    revertArtifact: (id: string) => ipcRenderer.invoke(CHANNELS.artifactRevert, id) as Promise<AgentArtifact>,
    orchestrate: (request: { tasks: Array<{ id: string; label: string; prompt: string; systemPrompt?: string; dependsOn?: string[] }>; maxConcurrency?: number; allowMutations?: boolean }) => ipcRenderer.invoke(CHANNELS.agentOrchestrate, request) as Promise<{ orchestrationId: string }>,
    cancelOrchestration: (id: string) => ipcRenderer.invoke(CHANNELS.agentOrchestrationCancel, id),
    onOrchestration: (listener: (event: AgentOrchestrationEvent) => void) => on(CHANNELS.agentOrchestrationEvent, listener),
  },
  menu: {
    onCommand: (listener: (command: string) => void) => on(CHANNELS.menuCommand, listener),
  },
};

contextBridge.exposeInMainWorld('bibzIDE', Object.freeze(api));
