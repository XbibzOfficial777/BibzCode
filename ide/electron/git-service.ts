import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommandResult, GitFileStatus } from '../shared/contracts.js';

const execFileAsync = promisify(execFile);

export class GitService {
  private async run(root: string, args: string[], timeout = 30_000): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: root,
        timeout,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message };
    }
  }

  async status(root: string): Promise<GitFileStatus[]> {
    const result = await this.run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (result.code !== 0) return [];
    const items = result.stdout.split('\0').filter(Boolean);
    return items.map((item) => ({ code: item.slice(0, 2), relativePath: item.slice(3) }));
  }

  async diff(root: string, relative = '', staged = false): Promise<string> {
    const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3'];
    if (staged) args.push('--cached');
    if (relative) args.push('--', relative);
    const result = await this.run(root, args);
    if (result.code !== 0) throw new Error(result.stderr || 'Git diff failed');
    return result.stdout;
  }

  async stage(root: string, relative: string): Promise<void> {
    const result = await this.run(root, ['add', '--', relative]);
    if (result.code !== 0) throw new Error(result.stderr || 'Git stage failed');
  }

  async unstage(root: string, relative: string): Promise<void> {
    const result = await this.run(root, ['restore', '--staged', '--', relative]);
    if (result.code !== 0) throw new Error(result.stderr || 'Git unstage failed');
  }

  async commit(root: string, message: string): Promise<string> {
    const clean = message.trim();
    if (!clean || clean.length > 500 || /[\r\n]/.test(clean)) throw new Error('Commit message must be one line and at most 500 characters');
    const result = await this.run(root, ['commit', '-m', clean], 60_000);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'Git commit failed');
    return result.stdout;
  }
}
