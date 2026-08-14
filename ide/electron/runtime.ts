import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExitEvent, ProcessEvent, RuntimeStatus } from '../shared/contracts.js';

const execFileAsync = promisify(execFile);
export type RuntimeEmitter = (channel: 'runtime:data' | 'runtime:exit', payload: ProcessEvent | ExitEvent) => void;

export class RuntimeService {
  readonly cliRoot: string;
  readonly runtimeRoot: string;
  private setupChild: ChildProcessWithoutNullStreams | null = null;

  constructor(resourcesPath: string, userData: string, packaged: boolean, private readonly emit: RuntimeEmitter) {
    this.cliRoot = packaged ? path.join(resourcesPath, 'cli') : path.resolve(import.meta.dirname, '..', '..');
    this.runtimeRoot = path.join(userData, 'runtime');
  }

  async status(configuredPython = ''): Promise<RuntimeStatus> {
    const managed = this.managedPython();
    if (await this.isPython(managed)) return this.readyStatus(managed, true);
    if (configuredPython && await this.isPython(configuredPython)) return this.readyStatus(configuredPython, false);
    const system = await this.findSystemPython();
    if (!system) {
      return { state: 'missing-python', managed: false, cliRoot: this.cliRoot, message: 'Python 3.10 or newer is required.' };
    }
    return {
      state: 'not-configured',
      python: system.path,
      pythonVersion: system.version,
      managed: false,
      cliRoot: this.cliRoot,
      message: 'Python is available. Run managed runtime setup to install locked BibzCode dependencies.',
    };
  }

  async resolvePython(configuredPython = ''): Promise<string> {
    const managed = this.managedPython();
    if (await this.isPython(managed)) return managed;
    if (configuredPython && await this.isPython(configuredPython)) return configuredPython;
    const system = await this.findSystemPython();
    if (!system) throw new Error('Python 3.10 or newer was not found');
    return system.path;
  }

  async setup(full: boolean, configuredPython = ''): Promise<string> {
    if (this.setupChild) throw new Error('Runtime setup is already running');
    const configuredIsValid = Boolean(configuredPython) && await this.isPython(configuredPython);
    const basePython = configuredIsValid ? configuredPython : (await this.findSystemPython())?.path ?? '';
    if (!basePython) throw new Error('Python 3.10 or newer was not found');
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const sessionId = randomUUID();
    const venv = path.join(this.runtimeRoot, 'venv');
    const requirements = [path.join(this.cliRoot, 'requirements-lock.txt')];
    if (full) requirements.push(path.join(this.cliRoot, 'requirements-optional-lock.txt'));
    const script = [
      'import os, subprocess, sys, venv',
      `target = ${JSON.stringify(venv)}`,
      'venv.EnvBuilder(with_pip=True, clear=False, upgrade=False).create(target)',
      `py = os.path.join(target, ${JSON.stringify(process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')})`,
      'subprocess.check_call([py, "-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", sys.argv[1]])',
      ...(full ? ['subprocess.check_call([py, "-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", sys.argv[2]])'] : []),
      'subprocess.check_call([py, "-c", "import bibzcode, httpx, rich, yaml; print(\\"BibzCode runtime verified\\")"], env={**os.environ, "PYTHONPATH": sys.argv[-1]})',
    ].join('; ');
    const args = ['-c', script, ...requirements, this.cliRoot];
    this.emit('runtime:data', { sessionId, stream: 'system', data: `Creating managed runtime with ${basePython}\r\n` });
    const child = spawn(basePython, args, {
      env: { ...process.env, PYTHONPATH: this.cliRoot, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.setupChild = child;
    child.stdout.on('data', (chunk: Buffer) => this.emit('runtime:data', { sessionId, stream: 'stdout', data: chunk.toString() }));
    child.stderr.on('data', (chunk: Buffer) => this.emit('runtime:data', { sessionId, stream: 'stderr', data: chunk.toString() }));
    child.once('error', (error) => this.emit('runtime:data', { sessionId, stream: 'system', data: `${error.message}\r\n` }));
    child.once('close', (code, signal) => {
      this.setupChild = null;
      this.emit('runtime:exit', { sessionId, code, signal });
    });
    return sessionId;
  }

  cliInvocation(python: string): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
    return {
      executable: python,
      args: ['-m', 'bibzcode'],
      env: { PYTHONPATH: this.cliRoot, BIBZCODE_IDE: '1' },
    };
  }

  private managedPython(): string {
    return path.join(this.runtimeRoot, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  }

  private async readyStatus(python: string, managed: boolean): Promise<RuntimeStatus> {
    const version = await this.pythonVersion(python);
    try {
      await execFileAsync(python, ['-c', 'import bibzcode, httpx, rich, yaml'], {
        timeout: 10_000,
        env: { ...process.env, PYTHONPATH: this.cliRoot },
        windowsHide: true,
      });
      return { state: 'ready', python, pythonVersion: version, managed, cliRoot: this.cliRoot, message: 'BibzCode runtime is ready.' };
    } catch {
      return { state: 'not-configured', python, pythonVersion: version, managed, cliRoot: this.cliRoot, message: 'Python was found, but locked BibzCode dependencies are not installed.' };
    }
  }

  private async findSystemPython(): Promise<{ path: string; version: string } | null> {
    const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
    for (const candidate of candidates) {
      try {
        if (candidate === 'py' && process.platform === 'win32') {
          const { stdout } = await execFileAsync(candidate, ['-3', '-c', 'import sys; print(sys.executable); print(".".join(map(str, sys.version_info[:3])))'], { timeout: 5000, windowsHide: true });
          const [executable, version] = stdout.trim().split(/\r?\n/);
          if (this.versionSupported(version)) return { path: executable, version };
        } else {
          const version = await this.pythonVersion(candidate);
          if (this.versionSupported(version)) return { path: candidate, version };
        }
      } catch { /* try next candidate */ }
    }
    return null;
  }

  private async isPython(executable: string): Promise<boolean> {
    if (!executable) return false;
    try {
      if (path.isAbsolute(executable)) await access(executable);
      return this.versionSupported(await this.pythonVersion(executable));
    } catch { return false; }
  }

  private async pythonVersion(executable: string): Promise<string> {
    const { stdout } = await execFileAsync(executable, ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'], { timeout: 5000, windowsHide: true });
    return stdout.trim();
  }

  private versionSupported(version: string): boolean {
    const [major, minor] = version.split('.').map(Number);
    return major > 3 || (major === 3 && minor >= 10);
  }
}
