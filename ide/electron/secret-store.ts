import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface SecretFile { [name: string]: string }

export class SecretStore {
  private data: SecretFile = {};
  readonly file: string;

  constructor(userData: string) { this.file = path.join(userData, 'secrets.json'); }

  async load(): Promise<void> {
    try { this.data = JSON.parse(await readFile(this.file, 'utf8')) as SecretFile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.data = {}; }
  }

  has(name: string): boolean { return Boolean(this.data[name]); }

  get(name: string): string {
    const encoded = this.data[name];
    if (!encoded) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable. Configure the key through an environment variable instead.');
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  async set(name: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable on this system.');
    this.data[name] = safeStorage.encryptString(value).toString('base64');
    await this.flush();
  }

  async clear(name: string): Promise<void> { delete this.data[name]; await this.flush(); }

  private async flush(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }
}
