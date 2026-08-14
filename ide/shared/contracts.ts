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

export interface RuntimeStatus {
  state: 'ready' | 'missing-python' | 'not-configured' | 'checking' | 'error';
  python?: string;
  pythonVersion?: string;
  managed: boolean;
  cliRoot: string;
  message: string;
}

export interface IdeSettings {
  pythonPath: string;
  shellPath: string;
  lastWorkspace: string;
  autoUpdate: boolean;
  confirmBeforeDelete: boolean;
  theme: 'bibz-dark' | 'high-contrast';
  editorFontSize: number;
  wordWrap: 'on' | 'off';
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
  cliStart: 'cli:start',
  cliInput: 'cli:input',
  cliStop: 'cli:stop',
  cliData: 'cli:data',
  cliExit: 'cli:exit',
  runtimeStatus: 'runtime:status',
  runtimeSetup: 'runtime:setup',
  runtimeData: 'runtime:data',
  runtimeExit: 'runtime:exit',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  workspaceChanged: 'workspace:changed',
  menuCommand: 'menu:command',
} as const;
