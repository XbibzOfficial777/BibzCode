import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { assertNoSymlinkEscape, assertRelativePath, isWithin, resolveWithin } from '../electron/security';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe('workspace path boundary', () => {
  it('accepts normalized relative paths', () => {
    expect(assertRelativePath('src/../src/main.ts')).toBe('src/main.ts');
    expect(resolveWithin('/workspace', 'src/main.ts')).toBe(path.resolve('/workspace/src/main.ts'));
  });

  it.each(['../secret', 'src/../../secret', '/etc/passwd', 'C:/Windows/System32', 'x\0y'])(
    'rejects renderer path %s', (value) => expect(() => assertRelativePath(value)).toThrow(),
  );

  it('uses separator-aware containment', () => {
    expect(isWithin('/work/app', '/work/app/src/a.ts')).toBe(true);
    expect(isWithin('/work/app', '/work/application/secret')).toBe(false);
  });

  it('rejects symlinks that escape the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bibz-ide-root-')); temporary.push(root);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'bibz-ide-out-')); temporary.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(root, 'escape'), 'dir');
    await expect(assertNoSymlinkEscape(root, path.join(root, 'escape', 'secret.txt'))).rejects.toThrow('Symlink escapes');
    await mkdir(path.join(root, 'safe'));
    await expect(assertNoSymlinkEscape(root, path.join(root, 'safe', 'new.txt'), true)).resolves.toBeUndefined();
    expect(await realpath(root)).toBe(root);
  });
});
