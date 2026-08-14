import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trashItem = vi.fn(async () => undefined);
vi.mock('electron', () => ({ shell: { trashItem } }));
const { WorkspaceService } = await import('../electron/workspace');

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; trashItem.mockClear(); });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'bibz-ide-workspace-')); });

describe('workspace service', () => {
  it('lists directories first and performs bounded text operations', async () => {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'README.md'), 'hello world\nsecond line\n');
    const service = new WorkspaceService(); service.setRoot(root);
    const entries = await service.list();
    expect(entries.map((item) => item.name)).toEqual(['src', 'README.md']);
    expect(await service.read('README.md')).toContain('hello world');
    await service.write('src/app.ts', 'export const ready = true;\n');
    expect(await readFile(path.join(root, 'src/app.ts'), 'utf8')).toContain('ready');
    await service.rename('src/app.ts', 'src/main.ts');
    expect((await service.search('ready'))[0].relativePath).toBe('src/main.ts');
  });

  it('never directly deletes and sends only bounded paths to system trash', async () => {
    await writeFile(path.join(root, 'remove.txt'), 'x');
    const service = new WorkspaceService(); service.setRoot(root);
    await service.trash('remove.txt');
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'remove.txt'));
    await expect(service.trash('../outside')).rejects.toThrow();
  });

  it('rejects binary and oversized editor input', async () => {
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    const service = new WorkspaceService(); service.setRoot(root);
    await expect(service.read('binary.bin')).rejects.toThrow('Binary');
    await expect(service.write('large.txt', 'x'.repeat(10 * 1024 * 1024 + 1))).rejects.toThrow('10 MiB');
  });
});
