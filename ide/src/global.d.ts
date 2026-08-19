import type {
  AppInfo,
  ExitEvent,
  FileEntry,
  GitFileStatus,
  IdeSettings,
  ProcessEvent,
  SearchMatch,
} from '../shared/contracts';

declare global {
  interface Window {
    bibzIDE: {
      app: {
        info(): Promise<AppInfo>;
        openExternal(url: string): Promise<void>;
        checkForUpdates(): Promise<{ available: boolean; version?: string; message: string }>;
      };
      workspace: {
        current(): Promise<string>;
        select(): Promise<string>;
        list(relative?: string): Promise<FileEntry[]>;
        search(query: string): Promise<SearchMatch[]>;
        onChanged(listener: (root: string) => void): () => void;
      };
      file: {
        read(relative: string): Promise<string>;
        write(relative: string, content: string): Promise<void>;
        create(relative: string, kind: 'file' | 'directory'): Promise<void>;
        rename(from: string, to: string): Promise<void>;
        trash(relative: string): Promise<void>;
      };
      terminal: {
        run(command: string): Promise<{ sessionId: string; cwd: string }>;
        stop(sessionId: string): Promise<void>;
        onData(listener: (event: ProcessEvent) => void): () => void;
        onExit(listener: (event: ExitEvent) => void): () => void;
      };
      git: {
        status(): Promise<GitFileStatus[]>;
        diff(relativePath?: string, staged?: boolean): Promise<string>;
        stage(relativePath: string): Promise<void>;
        unstage(relativePath: string): Promise<void>;
        commit(message: string): Promise<string>;
      };
      settings: {
        get(): Promise<IdeSettings>;
        set(patch: Partial<IdeSettings>): Promise<IdeSettings>;
      };
      secrets: {
        status(): Promise<{ configured: boolean }>;
        set(value: string): Promise<{ configured: boolean }>;
        clear(): Promise<{ configured: boolean }>;
      };
      agent: {
        probe(): Promise<import('../shared/contracts').ProviderProbe>;
        models(): Promise<string[]>;
        complete(prompt: string, systemPrompt?: string): Promise<string>;
        streamStart(requestId: string, prompt: string, systemPrompt?: string): Promise<{ requestId: string }>;
        onStream(listener: (event: import('../shared/contracts').AgentStreamEvent) => void): () => void;
        streamCancel(requestId: string): Promise<{ cancelled: boolean }>;
        approve(requestId: string, callId: string, approved: boolean): Promise<{ accepted: boolean }>;
        compress(text: string, targetChars: number): Promise<import('../shared/contracts').CompressionResult>;
      };
      menu: { onCommand(listener: (command: string) => void): () => void };
    };
  }
}

export {};
