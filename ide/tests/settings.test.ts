import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../electron/settings-store';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

describe('settings store', () => {
  it('validates, bounds, and atomically persists preferences', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bibz-ide-settings-')); temporary.push(directory);
    const store = new SettingsStore(directory);
    const defaults = await store.load();
    expect(defaults.editorFontSize).toBe(14);
    const saved = await store.set({ editorFontSize: 200, theme: 'high-contrast', wordWrap: 'on' });
    expect(saved.editorFontSize).toBe(32);
    expect(JSON.parse(await readFile(store.file, 'utf8')).theme).toBe('high-contrast');
    if (process.platform !== 'win32') expect((await stat(store.file)).mode & 0o777).toBe(0o600);
  });
});
