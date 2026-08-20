export type ActivityView = 'explorer' | 'search' | 'source-control' | 'tools' | 'settings';

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

export type IdeTheme = 'bibz-dark' | 'bibz-light' | 'high-contrast';
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
}

export interface AgentStreamEvent {
  requestId: string;
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
} as const;
