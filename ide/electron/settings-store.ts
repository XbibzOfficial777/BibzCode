import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IdeSettings } from '../shared/contracts.js';
import { isAiProvider, providerPreset } from '../shared/provider-catalog.js';

const DEFAULTS: IdeSettings = {
  shellPath: '', lastWorkspace: '', autoUpdate: true, confirmBeforeDelete: true,
  theme: 'bibz-dark', editorFontSize: 14, wordWrap: 'off',
  aiProvider: 'openai', aiBaseUrl: providerPreset('openai').baseUrl, aiModel: providerPreset('openai').defaultModel,
  thinkingEnabled: true, thinkingMode: 'adaptive', thinkingBudget: 8192,
  compressionMode: 'ultra', compressionContextWindow: 128000, compressionPreserveCode: true,
};

export class SettingsStore {
  readonly file: string;
  private data: IdeSettings = { ...DEFAULTS };
  constructor(userData: string) { this.file = path.join(userData, 'settings.json'); }

  async load(): Promise<IdeSettings> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<IdeSettings>;
      this.data = this.validate({ ...DEFAULTS, ...raw });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring invalid IDE settings'); }
    return this.get();
  }
  get(): IdeSettings { return { ...this.data }; }
  async set(patch: Partial<IdeSettings>): Promise<IdeSettings> {
    this.data = this.validate({ ...this.data, ...patch });
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
    return this.get();
  }

  private validate(value: IdeSettings): IdeSettings {
    const aiProvider = isAiProvider(value.aiProvider) ? value.aiProvider : 'openai';
    const preset = providerPreset(aiProvider);
    return {
      shellPath: typeof value.shellPath === 'string' ? value.shellPath.slice(0, 4096) : '',
      lastWorkspace: typeof value.lastWorkspace === 'string' ? value.lastWorkspace.slice(0, 4096) : '',
      autoUpdate: Boolean(value.autoUpdate), confirmBeforeDelete: Boolean(value.confirmBeforeDelete),
      theme: value.theme === 'high-contrast' ? 'high-contrast' : value.theme === 'bibz-light' ? 'bibz-light' : 'bibz-dark',
      editorFontSize: Math.max(10, Math.min(32, Number(value.editorFontSize) || 14)), wordWrap: value.wordWrap === 'on' ? 'on' : 'off',
      aiProvider,
      aiBaseUrl: typeof value.aiBaseUrl === 'string' && value.aiBaseUrl.trim() ? value.aiBaseUrl.slice(0, 2048) : preset.baseUrl,
      aiModel: typeof value.aiModel === 'string' && value.aiModel.trim() ? value.aiModel.slice(0, 256) : preset.defaultModel,
      thinkingEnabled: Boolean(value.thinkingEnabled), thinkingMode: ['off', 'fast', 'balanced', 'deep', 'adaptive'].includes(value.thinkingMode) ? value.thinkingMode : 'adaptive',
      thinkingBudget: Math.max(0, Math.min(200000, Number(value.thinkingBudget) || 8192)),
      compressionMode: ['off', 'balanced', 'ultra'].includes(value.compressionMode) ? value.compressionMode : 'ultra',
      compressionContextWindow: Math.max(4096, Math.min(1000000, Number(value.compressionContextWindow) || 128000)), compressionPreserveCode: value.compressionPreserveCode !== false,
    };
  }
}
