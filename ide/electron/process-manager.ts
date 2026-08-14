import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExitEvent, ProcessEvent } from '../shared/contracts.js';
import { MAX_COMMAND_CHARS, isWithin } from './security.js';

export type ProcessEmitter = (channel: 'terminal:data' | 'terminal:exit' | 'cli:data' | 'cli:exit', payload: ProcessEvent | ExitEvent) => void;

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    killer.unref();
  } else if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => {
      if (!child.killed && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, 2500).unref();
  }
}

export class ProcessManager {
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();
  private terminalCwd = '';
  private cliId = '';

  constructor(private readonly emit: ProcessEmitter) {}

  setWorkspace(root: string): void {
    this.terminalCwd = root;
  }

  getTerminalCwd(): string {
    return this.terminalCwd;
  }

  async runTerminal(command: string, workspace: string, shellOverride = ''): Promise<{ sessionId: string; cwd: string }> {
    const trimmed = command.trim();
    if (!trimmed) throw new Error('Command is empty');
    if (trimmed.length > MAX_COMMAND_CHARS) throw new Error('Command exceeds 8192 characters');
    const cwd = this.terminalCwd && isWithin(workspace, this.terminalCwd) ? this.terminalCwd : workspace;

    const cdMatch = trimmed.match(/^cd(?:\s+(.+))?$/);
    if (cdMatch) {
      const raw = (cdMatch[1] ?? workspace).trim().replace(/^['"]|['"]$/g, '');
      const next = path.resolve(cwd, raw || workspace);
      if (!isWithin(workspace, next)) throw new Error('Terminal working directory must remain inside the workspace');
      const info = await stat(next).catch(() => null);
      if (!info?.isDirectory()) throw new Error('Terminal working directory does not exist');
      this.terminalCwd = next;
      const sessionId = randomUUID();
      queueMicrotask(() => {
        this.emit('terminal:data', { sessionId, stream: 'system', data: `cwd: ${next}\r\n` });
        this.emit('terminal:exit', { sessionId, code: 0, signal: null });
      });
      return { sessionId, cwd: next };
    }

    const sessionId = randomUUID();
    const { executable, args } = this.shellCommand(trimmed, shellOverride);
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, BIBZCODE_WORKSPACE: workspace, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.children.set(sessionId, child);
    child.stdout.on('data', (chunk: Buffer) => this.emit('terminal:data', { sessionId, stream: 'stdout', data: chunk.toString() }));
    child.stderr.on('data', (chunk: Buffer) => this.emit('terminal:data', { sessionId, stream: 'stderr', data: chunk.toString() }));
    child.once('error', (error) => this.emit('terminal:data', { sessionId, stream: 'system', data: `Unable to start command: ${error.message}\r\n` }));
    child.once('close', (code, signal) => {
      this.children.delete(sessionId);
      this.emit('terminal:exit', { sessionId, code, signal });
    });
    return { sessionId, cwd };
  }

  startCli(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
    if (this.cliId) this.stop(this.cliId);
    const sessionId = randomUUID();
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env, TERM: 'xterm-256color', FORCE_COLOR: '1', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.cliId = sessionId;
    this.children.set(sessionId, child);
    child.stdout.on('data', (chunk: Buffer) => this.emit('cli:data', { sessionId, stream: 'stdout', data: chunk.toString() }));
    child.stderr.on('data', (chunk: Buffer) => this.emit('cli:data', { sessionId, stream: 'stderr', data: chunk.toString() }));
    child.once('error', (error) => this.emit('cli:data', { sessionId, stream: 'system', data: `Unable to start BibzCode: ${error.message}\r\n` }));
    child.once('close', (code, signal) => {
      this.children.delete(sessionId);
      if (this.cliId === sessionId) this.cliId = '';
      this.emit('cli:exit', { sessionId, code, signal });
    });
    return sessionId;
  }

  inputCli(sessionId: string, data: string): void {
    if (sessionId !== this.cliId) throw new Error('BibzCode session is not active');
    if (typeof data !== 'string' || data.length > 65_536) throw new Error('CLI input is invalid');
    const child = this.children.get(sessionId);
    if (!child?.stdin.writable) throw new Error('BibzCode input stream is closed');
    child.stdin.write(data);
  }

  stop(sessionId: string): void {
    const child = this.children.get(sessionId);
    if (child) terminate(child);
  }

  stopAll(): void {
    for (const child of this.children.values()) terminate(child);
    this.children.clear();
    this.cliId = '';
  }

  private shellCommand(command: string, shellOverride: string): { executable: string; args: string[] } {
    if (process.platform === 'win32') {
      const executable = shellOverride || 'powershell.exe';
      const lower = path.basename(executable).toLowerCase();
      return lower.startsWith('cmd')
        ? { executable, args: ['/d', '/s', '/c', command] }
        : { executable, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] };
    }
    return { executable: shellOverride || process.env.SHELL || '/bin/bash', args: ['-lc', command] };
  }
}
