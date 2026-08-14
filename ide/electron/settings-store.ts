import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IdeSettings } from '../shared/contracts.js';

const DEFAULTS: IdeSettings = {
  pythonPath: '',
  shellPath: '',
  lastWorkspace: '',
  autoUpdate: true,
  confirmBeforeDelete: true,
  theme: 'bibz-dark',
  editorFontSize: 14,
  wordWrap: 'off',
};

export class SettingsStore {
  readonly file: string;
  private data: IdeSettings = { ...DEFAULTS };

  constructor(userData: string) {
    this.file = path.join(userData, 'settings.json');
  }

  async load(): Promise<IdeSettings> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<IdeSettings>;
      this.data = this.validate({ ...DEFAULTS, ...raw });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Ignoring invalid IDE settings');
    }
    return this.get();
  }

  get(): IdeSettings {
    return { ...this.data };
  }

  async set(patch: Partial<IdeSettings>): Promise<IdeSettings> {
    this.data = this.validate({ ...this.data, ...patch });
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
    return this.get();
  }

  private validate(value: IdeSettings): IdeSettings {
    return {
      pythonPath: typeof value.pythonPath === 'string' ? value.pythonPath.slice(0, 4096) : '',
      shellPath: typeof value.shellPath === 'string' ? value.shellPath.slice(0, 4096) : '',
      lastWorkspace: typeof value.lastWorkspace === 'string' ? value.lastWorkspace.slice(0, 4096) : '',
      autoUpdate: Boolean(value.autoUpdate),
      confirmBeforeDelete: Boolean(value.confirmBeforeDelete),
      theme: value.theme === 'high-contrast' ? 'high-contrast' : 'bibz-dark',
      editorFontSize: Math.max(10, Math.min(28, Number(value.editorFontSize) || 14)),
      wordWrap: value.wordWrap === 'on' ? 'on' : 'off',
    };
  }
}
