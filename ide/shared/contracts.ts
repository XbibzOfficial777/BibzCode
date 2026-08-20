export type ActivityView = 'explorer' | 'search' | 'source-control' | 'tools' | 'settings' | 'extensions';
export type ExtensionRegistry = 'open-vsx' | 'vscode-marketplace';

export interface ExtensionGalleryItem {
  id: string;
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  source: ExtensionRegistry;
  downloadUrl: string;
  iconUrl?: string;
  readmeUrl?: string;
  enginesVscode?: string;
  categories: string[];
  downloadCount?: number;
  rating?: number;
  compatible: boolean;
  compatibilityMessage?: string;
  installedVersion?: string;
  enabled?: boolean;
}

export type ExtensionTrust = 'untrusted' | 'trusted';
export type ExtensionRuntimeState = 'stopped' | 'starting' | 'running' | 'failed';

export interface ExtensionRiskAssessment {
  trust: ExtensionTrust;
  reasons: string[];
  nativeBinaries: string[];
  proposedApi: boolean;
  activationEvents: string[];
  hasMainEntry: boolean;
}

export interface ExtensionRuntimeStatus {
  id: string;
  state: ExtensionRuntimeState;
  message: string;
  commands: string[];
  activatedAt?: string;
}

export interface InstalledExtension {
  id: string;
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  installPath: string;
  source: ExtensionRegistry | 'vsix';
  enginesVscode?: string;
  enabled: boolean;
  trust: ExtensionTrust;
  risk: ExtensionRiskAssessment;
  installedAt: string;
  manifest: Record<string, unknown>;
}

export interface ExtensionRuntimeEvent {
  type: 'status' | 'command' | 'message';
  id: string;
  status?: ExtensionRuntimeStatus;
  command?: string;
  arguments?: unknown[];
  message?: string;
}

export type ArtifactOperation = 'write' | 'create' | 'rename' | 'trash';
export type ArtifactStatus = 'applied' | 'kept' | 'reverted' | 'rejected';

export interface AgentArtifact {
  id: string;
  requestId: string;
  operation: ArtifactOperation;
  status: ArtifactStatus;
  relativePath: string;
  fromPath?: string;
  toPath?: string;
  kind?: 'file' | 'directory';
  beforeExists: boolean;
  afterExists: boolean;
  beforeContent?: string;
  afterContent?: string;
  createdAt: string;
  summary: string;
}

export type OrchestrationEventType = 'started' | 'task-start' | 'task-done' | 'task-error' | 'done' | 'cancelled';

export interface AgentOrchestrationTask {
  id: string;
  label: string;
  prompt: string;
  systemPrompt?: string;
  dependsOn?: string[];
}

export interface AgentOrchestrationRequest {
  tasks: AgentOrchestrationTask[];
  maxConcurrency?: number;
  allowMutations?: boolean;
}

export interface AgentOrchestrationEvent {
  orchestrationId: string;
  type: OrchestrationEventType;
  taskId?: string;
  requestId?: string;
  label?: string;
  message?: string;
}

export interface AgentStreamEvent {
  requestId: string;
  orchestrationId?: string;
  taskId?: string;
  type: 'start' | 'delta' | 'tool_call' | 'tool_result' | 'approval_request' | 'done' | 'error';
  delta?: string;
  text?: string;
  message?: string;
  callId?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: string;
  risk?: 'read' | 'write' | 'terminal' | 'git';
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string;
  hidden: boolean;
}

export interface OpenFile {
  relativePath: string;
  content: string;
  language: string;
  dirty: boolean;
}

export interface SearchMatch {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
}

export interface GitFileStatus {
  code: string;
  relativePath: string;
}

export type IdeTheme = 'bibz-dark' | 'bibz-light' | 'high-contrast' | 'system';
export type AiProvider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'openrouter' | 'ollama' | 'groq' | 'together' | 'huggingface' | 'mistral' | 'fireworks' | 'cerebras' | 'xai' | 'perplexity' | 'moonshot' | 'qwen' | 'siliconflow' | 'nvidia' | 'cohere' | 'sambanova' | 'novita' | 'hyperbolic' | 'deepinfra' | 'ai21' | 'minimax' | 'zhipu' | 'modelscope' | 'friendli' | 'replicate' | 'agnes' | 'lmstudio' | 'vllm' | 'litellm' | 'custom';
export type ThinkingMode = 'off' | 'fast' | 'balanced' | 'deep' | 'adaptive';
export type CompressionMode = 'off' | 'balanced' | 'ultra';

export interface IdeSettings {
  shellPath: string;
  lastWorkspace: string;
  autoUpdate: boolean;
  confirmBeforeDelete: boolean;
  theme: IdeTheme;
  editorFontSize: number;
  wordWrap: 'on' | 'off';
  aiProvider: AiProvider;
  aiBaseUrl: string;
  aiModel: string;
  thinkingEnabled: boolean;
  thinkingMode: ThinkingMode;
  thinkingBudget: number;
  compressionMode: CompressionMode;
  compressionContextWindow: number;
  compressionPreserveCode: boolean;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessEvent {
  sessionId: string;
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
}

export interface ExitEvent {
  sessionId: string;
  code: number | null;
  signal: string | null;
}

export interface ProviderProbe {
  ok: boolean;
  status: number;
  message: string;
  latencyMs: number;
}

export interface CompressionResult {
  text: string;
  originalChars: number;
  compressedChars: number;
  ratio: number;
  preservedBlocks: number;
}

export interface AgentCompletionRequest {
  prompt: string;
  systemPrompt?: string;
  requestId?: string;
  taskId?: string;
  allowMutations?: boolean;
}

export const CHANNELS = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  updateCheck: 'update:check',
  workspaceSelect: 'workspace:select',
  workspaceCurrent: 'workspace:current',
  workspaceList: 'workspace:list',
  workspaceSearch: 'workspace:search',
  fileRead: 'file:read',
  fileWrite: 'file:write',
  fileCreate: 'file:create',
  fileRename: 'file:rename',
  fileTrash: 'file:trash',
  terminalRun: 'terminal:run',
  terminalStop: 'terminal:stop',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  secretSet: 'secret:set',
  secretClear: 'secret:clear',
  secretStatus: 'secret:status',
  agentProbe: 'agent:probe',
  agentModels: 'agent:models',
  agentComplete: 'agent:complete',
  agentStreamStart: 'agent:stream-start',
  agentStreamEvent: 'agent:stream-event',
  agentStreamCancel: 'agent:stream-cancel',
  agentApprove: 'agent:approve',
  compressionTest: 'agent:compression-test',
  workspaceChanged: 'workspace:changed',
  menuCommand: 'menu:command',
  extensionSearch: 'extension:search',
  extensionInstalled: 'extension:installed',
  extensionInstall: 'extension:install',
  extensionInstallVsix: 'extension:install-vsix',
  extensionUninstall: 'extension:uninstall',
  extensionSetEnabled: 'extension:set-enabled',
  extensionSetTrust: 'extension:set-trust',
  extensionRuntimeStart: 'extension:runtime-start',
  extensionRuntimeStop: 'extension:runtime-stop',
  extensionRuntimeStatus: 'extension:runtime-status',
  extensionRuntimeCommand: 'extension:runtime-command',
  extensionRuntimeEvent: 'extension:runtime-event',
  artifactList: 'agent:artifact-list',
  artifactKeep: 'agent:artifact-keep',
  artifactReject: 'agent:artifact-reject',
  artifactRevert: 'agent:artifact-revert',
  agentOrchestrate: 'agent:orchestrate',
  agentOrchestrationCancel: 'agent:orchestration-cancel',
  agentOrchestrationEvent: 'agent:orchestration-event',
} as const;
