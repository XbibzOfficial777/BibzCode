import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_WRITE_BYTES = 10 * 1024 * 1024;
export const MAX_COMMAND_CHARS = 8192;
export const MAX_SEARCH_RESULTS = 500;

export function assertRelativePath(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A relative path is required');
  if (value.includes('\0')) throw new Error('NUL bytes are not allowed in paths');
  const normalized = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error('Absolute paths are not accepted from the renderer');
  }
  const clean = path.posix.normalize(normalized);
  if (clean === '..' || clean.startsWith('../')) throw new Error('Path escapes the workspace');
  return clean === '.' ? '' : clean;
}

export function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function resolveWithin(root: string, relative: string): string {
  const clean = relative === '' ? '' : assertRelativePath(relative);
  const candidate = path.resolve(root, clean);
  if (!isWithin(root, candidate)) throw new Error('Path escapes the workspace');
  return candidate;
}

export async function assertNoSymlinkEscape(root: string, target: string, allowMissing = false): Promise<void> {
  const canonicalRoot = await realpath(root);
  try {
    const canonicalTarget = await realpath(target);
    if (!isWithin(canonicalRoot, canonicalTarget)) throw new Error('Symlink escapes the workspace');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!allowMissing || code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    const canonicalParent = await realpath(parent);
    if (!isWithin(canonicalRoot, canonicalParent)) throw new Error('Parent symlink escapes the workspace', { cause: error });
  }
}

export function assertTextSize(content: string): void {
  if (typeof content !== 'string') throw new Error('File content must be text');
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('File exceeds the 10 MiB editor limit');
}

export async function assertReadableTextFile(file: string): Promise<number> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Selected path is not a regular file');
  if (info.size > MAX_TEXT_FILE_BYTES) throw new Error('File exceeds the 10 MiB editor limit');
  return info.size;
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}
