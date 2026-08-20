import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { ExtensionRuntimeEvent, ExtensionRuntimeStatus, InstalledExtension } from '../shared/contracts.js';

type HostMessage =
  | { type: 'activate'; id: string; installPath: string; entry: string; settings: Record<string, unknown> }
  | { type: 'execute-command'; id: string; command: string; arguments?: unknown[] }
  | { type: 'deactivate'; id: string };

type HostEvent =
  | { type: 'status'; id: string; state: ExtensionRuntimeStatus['state']; message: string; commands: string[]; activatedAt?: string }
  | { type: 'command'; id: string; command: string; arguments: unknown[] }
  | { type: 'message'; id: string; message: string };

export class ExtensionHostManager {
  private process: ChildProcess | null = null;
  private statuses = new Map<string, ExtensionRuntimeStatus>();
  private readonly hostPath: string;

  constructor(private readonly emit: (event: ExtensionRuntimeEvent) => void, private readonly settings: () => Record<string, unknown>) {
    this.hostPath = path.join(import.meta.dirname, 'extension-host.cjs');
  }

  private ensureProcess(): ChildProcess {
    if (this.process && !this.process.killed) return this.process;
    const child = fork(this.hostPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: false, windowsHide: true, execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BIBZCODE_EXTENSION_HOST: '1' } });
    child.on('message', (message: HostEvent) => this.handle(message));
    child.on('exit', (_code, signal) => {
      for (const status of this.statuses.values()) {
        if (status.state !== 'stopped') {
          const stopped = { ...status, state: 'failed' as const, message: `Extension host exited${signal ? ` (${signal})` : ''}.` };
          this.statuses.set(status.id, stopped); this.emit({ type: 'status', id: status.id, status: stopped });
        }
      }
      this.process = null;
    });
    child.on('error', (error) => this.emit({ type: 'message', id: '', message: `Extension host error: ${error.message}` }));
    this.process = child; return child;
  }

  private handle(message: HostEvent): void {
    if (message.type === 'status') {
      const status: ExtensionRuntimeStatus = { id: message.id, state: message.state, message: message.message, commands: message.commands, activatedAt: message.activatedAt };
      this.statuses.set(message.id, status); this.emit({ type: 'status', id: message.id, status }); return;
    }
    if (message.type === 'command') { this.emit({ type: 'command', id: message.id, command: message.command, arguments: message.arguments }); return; }
    this.emit({ type: 'message', id: message.id, message: message.message });
  }

  status(): ExtensionRuntimeStatus[] { return [...this.statuses.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  async start(extension: InstalledExtension): Promise<ExtensionRuntimeStatus> {
    if (!extension.enabled) throw new Error('Enable the extension before starting its runtime.');
    if (extension.trust !== 'trusted') throw new Error('Extension is not trusted. Review its risk report and trust it before activation.');
    if (!extension.risk.hasMainEntry || typeof extension.manifest.main !== 'string') throw new Error('This extension has no executable main entry; static contributions do not need a runtime host.');
    const starting: ExtensionRuntimeStatus = { id: extension.id, state: 'starting', message: 'Starting guarded extension host…', commands: [] };
    this.statuses.set(extension.id, starting); this.emit({ type: 'status', id: extension.id, status: starting });
    const child = this.ensureProcess();
    const message: HostMessage = { type: 'activate', id: extension.id, installPath: extension.installPath, entry: extension.manifest.main, settings: this.settings() };
    child.send(message);
    return starting;
  }

  async stop(id: string): Promise<void> { if (!this.process || this.process.killed) return; this.process.send({ type: 'deactivate', id } satisfies HostMessage); }

  async executeCommand(id: string, command: string, args: unknown[] = []): Promise<void> {
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(command)) throw new Error('Extension command name is invalid.');
    if (!this.process || this.process.killed) throw new Error('Extension host is not running.');
    const status = this.statuses.get(id); if (status?.state !== 'running' || !status.commands.includes(command)) throw new Error('Extension command is not active.');
    this.process.send({ type: 'execute-command', id, command, arguments: args } satisfies HostMessage);
  }

  stopAll(): void { if (this.process && !this.process.killed) this.process.kill(); this.process = null; this.statuses.clear(); }
}
