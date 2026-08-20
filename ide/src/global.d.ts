import type {
  AppInfo,
  ExitEvent,
  FileEntry,
  GitFileStatus,
  IdeSettings,
  ExtensionGalleryItem,
  ExtensionRuntimeEvent,
  ExtensionRuntimeStatus,
  AgentArtifact,
  AgentOrchestrationEvent,
  InstalledExtension,
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
      extensions: {
        search(query: string, registry: 'open-vsx' | 'vscode-marketplace'): Promise<ExtensionGalleryItem[]>;
        installed(): Promise<InstalledExtension[]>;
        install(item: ExtensionGalleryItem): Promise<InstalledExtension>;
        installVsix(): Promise<InstalledExtension | null>;
        uninstall(id: string): Promise<void>;
        setEnabled(id: string, enabled: boolean): Promise<InstalledExtension>;
        setTrust(id: string, trust: 'trusted' | 'untrusted'): Promise<InstalledExtension>;
        runtimeStart(id: string): Promise<ExtensionRuntimeStatus>;
        runtimeStop(id: string): Promise<void>;
        runtimeStatus(): Promise<ExtensionRuntimeStatus[]>;
        runtimeCommand(id: string, command: string, args?: unknown[]): Promise<void>;
        onRuntimeEvent(listener: (event: ExtensionRuntimeEvent) => void): () => void;
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
        artifacts(requestId?: string): Promise<AgentArtifact[]>;
        keepArtifact(id: string): Promise<AgentArtifact>;
        rejectArtifact(id: string): Promise<AgentArtifact>;
        revertArtifact(id: string): Promise<AgentArtifact>;
        orchestrate(request: { tasks: Array<{ id: string; label: string; prompt: string; systemPrompt?: string; dependsOn?: string[] }>; maxConcurrency?: number; allowMutations?: boolean }): Promise<{ orchestrationId: string }>;
        cancelOrchestration(id: string): Promise<{ cancelled: boolean }>;
        onOrchestration(listener: (event: AgentOrchestrationEvent) => void): () => void;
      };
      menu: { onCommand(listener: (command: string) => void): () => void };
    };
  }
}

export {};
