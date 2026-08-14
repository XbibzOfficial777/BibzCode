import type {
  AppInfo,
  ExitEvent,
  FileEntry,
  GitFileStatus,
  IdeSettings,
  ProcessEvent,
  RuntimeStatus,
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
      cli: {
        start(): Promise<string>;
        input(sessionId: string, data: string): Promise<void>;
        stop(sessionId: string): Promise<void>;
        onData(listener: (event: ProcessEvent) => void): () => void;
        onExit(listener: (event: ExitEvent) => void): () => void;
      };
      runtime: {
        status(): Promise<RuntimeStatus>;
        setup(full: boolean): Promise<string>;
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
      menu: { onCommand(listener: (command: string) => void): () => void };
    };
  }
}

export {};
