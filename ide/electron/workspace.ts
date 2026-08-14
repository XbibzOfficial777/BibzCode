import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import type { FileEntry, SearchMatch } from '../shared/contracts.js';
import {
  MAX_SEARCH_RESULTS,
  assertNoSymlinkEscape,
  assertReadableTextFile,
  assertRelativePath,
  assertTextSize,
  resolveWithin,
} from './security.js';

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build', 'coverage']);

export class WorkspaceService {
  private root = '';

  setRoot(root: string): void {
    this.root = path.resolve(root);
  }

  getRoot(): string {
    return this.root;
  }

  requireRoot(): string {
    if (!this.root) throw new Error('Open a workspace folder first');
    return this.root;
  }

  async list(relative = ''): Promise<FileEntry[]> {
    const root = this.requireRoot();
    const directory = resolveWithin(root, relative);
    await assertNoSymlinkEscape(root, directory);
    const entries = await readdir(directory, { withFileTypes: true });
    const output: FileEntry[] = [];
    for (const entry of entries.slice(0, 1000)) {
      const relativePath = path.posix.join(relative ? assertRelativePath(relative) : '', entry.name);
      const absolute = resolveWithin(root, relativePath);
      const info = await stat(absolute).catch(() => null);
      output.push({
        name: entry.name,
        relativePath,
        kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file',
        size: info?.size ?? 0,
        modifiedAt: info?.mtime.toISOString() ?? new Date(0).toISOString(),
        hidden: entry.name.startsWith('.'),
      });
    }
    return output.sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1;
      if (a.kind !== 'directory' && b.kind === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  async read(relative: string): Promise<string> {
    const root = this.requireRoot();
    const file = resolveWithin(root, relative);
    await assertNoSymlinkEscape(root, file);
    await assertReadableTextFile(file);
    const data = await readFile(file);
    if (data.includes(0)) throw new Error('Binary files cannot be opened in the text editor');
    return data.toString('utf8');
  }

  async write(relative: string, content: string): Promise<void> {
    const root = this.requireRoot();
    const file = resolveWithin(root, relative);
    assertTextSize(content);
    await assertNoSymlinkEscape(root, file, true);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const existing = await stat(file).catch(() => null);
    const mode = existing?.isFile() ? existing.mode & 0o777 : 0o600;
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.bibz-tmp-${process.pid}`);
    await writeFile(temporary, content, { encoding: 'utf8', mode, flag: 'wx' });
    await rename(temporary, file);
  }

  async create(relative: string, kind: 'file' | 'directory'): Promise<void> {
    const root = this.requireRoot();
    const target = resolveWithin(root, relative);
    await assertNoSymlinkEscape(root, target, true);
    if (kind === 'directory') await mkdir(target, { recursive: false, mode: 0o700 });
    else await writeFile(target, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }

  async rename(from: string, to: string): Promise<void> {
    const root = this.requireRoot();
    const source = resolveWithin(root, from);
    const destination = resolveWithin(root, to);
    await assertNoSymlinkEscape(root, source);
    await assertNoSymlinkEscape(root, destination, true);
    await rename(source, destination);
  }

  async trash(relative: string): Promise<void> {
    const root = this.requireRoot();
    const target = resolveWithin(root, relative);
    await assertNoSymlinkEscape(root, target);
    if (target === root) throw new Error('The workspace root cannot be deleted');
    await shell.trashItem(target);
  }

  async search(query: string): Promise<SearchMatch[]> {
    const root = this.requireRoot();
    const needle = query.trim();
    if (!needle || needle.length > 500) return [];
    const lowered = needle.toLocaleLowerCase();
    const matches: SearchMatch[] = [];

    const walk = async (directory: string): Promise<void> => {
      if (matches.length >= MAX_SEARCH_RESULTS) return;
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (matches.length >= MAX_SEARCH_RESULTS) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) await walk(absolute);
          continue;
        }
        const info = await stat(absolute).catch(() => null);
        if (!info?.isFile() || info.size > 2 * 1024 * 1024) continue;
        const data = await readFile(absolute).catch(() => null);
        if (!data || data.includes(0)) continue;
        const lines = data.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_RESULTS; index += 1) {
          const column = lines[index].toLocaleLowerCase().indexOf(lowered);
          if (column >= 0) {
            matches.push({
              relativePath: path.relative(root, absolute).split(path.sep).join('/'),
              line: index + 1,
              column: column + 1,
              preview: lines[index].trim().slice(0, 300),
            });
          }
        }
      }
    };

    await walk(root);
    return matches;
  }
}
