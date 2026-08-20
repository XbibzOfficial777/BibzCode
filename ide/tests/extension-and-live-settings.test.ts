import { readFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessExtension, compatibleWithVscode } from '../electron/extension-service';
import { SettingsStore } from '../electron/settings-store';

describe('VS Code extension compatibility', () => {
  it('accepts a supported concrete engine range and rejects wildcard/mismatched ranges', () => {
    expect(compatibleWithVscode('^1.70.0').compatible).toBe(true);
    expect(compatibleWithVscode('>=1.90.0 <2.0.0').compatible).toBe(true);
    expect(compatibleWithVscode('*').compatible).toBe(false);
    expect(compatibleWithVscode('^2.0.0').compatible).toBe(false);
  });
});

describe('extension trust policy', () => {
  it('trusts static contributions but blocks executable/proposed activation by default', async () => {
    const staticRisk = await assessExtension({ name: 'theme-pack', contributes: { themes: [] } });
    expect(staticRisk.trust).toBe('trusted');
    const executableRisk = await assessExtension({ main: './dist/extension.js', activationEvents: ['*'], enableProposedApi: true });
    expect(executableRisk.trust).toBe('untrusted');
    expect(executableRisk.hasMainEntry).toBe(true);
    expect(executableRisk.proposedApi).toBe(true);
    expect(executableRisk.activationEvents).toContain('*');
  });
});

describe('live settings persistence', () => {
  it('serializes rapid snapshots and preserves system theme', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bibz-ide-live-settings-'));
    try {
      const store = new SettingsStore(directory); await store.load();
      await Promise.all([store.set({ theme: 'system' }), store.set({ editorFontSize: 18 }), store.set({ wordWrap: 'on' })]);
      const saved = JSON.parse(await readFile(store.file, 'utf8')) as { theme: string; editorFontSize: number; wordWrap: string };
      expect(saved.theme).toBe('system'); expect(saved.editorFontSize).toBe(18); expect(saved.wordWrap).toBe('on');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
