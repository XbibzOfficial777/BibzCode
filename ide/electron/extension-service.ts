import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExtensionGalleryItem, ExtensionRegistry, InstalledExtension } from '../shared/contracts.js';

const execFileAsync = promisify(execFile);
const CURRENT_VSCODE_API = [1, 100, 0] as const;
const OPEN_VSX = 'https://open-vsx.org';
const VS_MARKETPLACE = 'https://marketplace.visualstudio.com';
const MAX_VSIX_BYTES = 100 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 40;

interface OpenVsxItem { namespace?: string; name?: string; version?: string; displayName?: string; description?: string; files?: { download?: string; icon?: string; readme?: string }; engines?: { vscode?: string }; categories?: string[]; downloadCount?: number; averageRating?: number }
interface MarketplaceExtension { extensionId?: string; extensionName?: string; displayName?: string; publisher?: { publisherName?: string }; versions?: Array<{ version?: string; properties?: Array<{ key?: string; value?: string }>; assetUri?: string }>; shortDescription?: string; categories?: string[]; statistics?: Array<{ statisticName?: string; value?: number }>; publisherDisplayName?: string }

function versionTuple(value: string): [number, number, number] {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/); return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0)];
}
function compareVersion(a: readonly [number, number, number], b: readonly [number, number, number]): number { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }
export function compatibleWithVscode(range?: string): { compatible: boolean; message?: string } {
  if (!range || range === '*') return { compatible: false, message: 'The extension does not declare a concrete VS Code engine range.' };
  const minimum = versionTuple(range); const current = CURRENT_VSCODE_API;
  if (/^\^\d+\.\d+/.test(range) && minimum[0] === current[0] && compareVersion(current, minimum) >= 0) return { compatible: true };
  if (/^(>=|~|\d+\.\d+)/.test(range) && compareVersion(current, minimum) >= 0) return { compatible: true };
  return { compatible: false, message: `Requires VS Code ${range}; BibzCode advertises API compatibility ${CURRENT_VSCODE_API.join('.')}.` };
}
function asNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function safeText(value: unknown, max = 5000): string { return typeof value === 'string' ? value.slice(0, max) : ''; }
function extensionId(publisher: string, name: string): string { return `${publisher}.${name}`; }

export class ExtensionService {
  private installed = new Map<string, InstalledExtension>();
  private readonly root: string;
  private readonly stateFile: string;

  constructor(userData: string) { this.root = path.join(userData, 'extensions'); this.stateFile = path.join(this.root, 'installed.json'); }

  async load(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const raw = await readFile(this.stateFile, 'utf8').catch(() => '[]');
    try {
      const items = JSON.parse(raw) as InstalledExtension[];
      this.installed = new Map(items.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
    } catch { this.installed.clear(); }
  }
  private async persist(): Promise<void> {
    const temp = `${this.stateFile}.tmp-${process.pid}`;
    await writeFile(temp, `${JSON.stringify([...this.installed.values()], null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.stateFile);
  }
  private decorate(item: ExtensionGalleryItem): ExtensionGalleryItem {
    const current = this.installed.get(item.id); return { ...item, installedVersion: current?.version, enabled: current?.enabled };
  }
  private openVsxItem(item: OpenVsxItem): ExtensionGalleryItem | null {
    if (!item.namespace || !item.name || !item.version) return null;
    const id = extensionId(item.namespace, item.name); const compatibility = compatibleWithVscode(item.engines?.vscode);
    return this.decorate({ id, publisher: item.namespace, name: item.name, displayName: safeText(item.displayName || item.name, 200), version: item.version, description: safeText(item.description), source: 'open-vsx', downloadUrl: item.files?.download || `${OPEN_VSX}/api/${encodeURIComponent(item.namespace)}/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}/file/${encodeURIComponent(item.name)}-${encodeURIComponent(item.version)}.vsix`, iconUrl: item.files?.icon, readmeUrl: item.files?.readme, enginesVscode: safeText(item.engines?.vscode, 100), categories: Array.isArray(item.categories) ? item.categories.slice(0, 12).map((value) => safeText(value, 80)) : [], downloadCount: asNumber(item.downloadCount), rating: asNumber(item.averageRating), ...compatibility });
  }
  private marketplaceItem(item: MarketplaceExtension): ExtensionGalleryItem | null {
    const publisher = item.publisher?.publisherName; const name = item.extensionName; const version = item.versions?.[0]?.version; if (!publisher || !name || !version) return null;
    const versionData = item.versions?.[0]; const base = versionData?.assetUri || `${VS_MARKETPLACE}/_apis/public/gallery/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
    const enginesVscode = versionData?.properties?.find((property) => property.key === 'Microsoft.VisualStudio.Code.Engine')?.value;
    const compatibility = compatibleWithVscode(enginesVscode); const installs = item.statistics?.find((statistic) => statistic.statisticName === 'install')?.value;
    return this.decorate({ id: extensionId(publisher, name), publisher, name, displayName: safeText(item.displayName || name, 200), version, description: safeText(item.shortDescription), source: 'vscode-marketplace', downloadUrl: `${base}/Microsoft.VisualStudio.Services.VSIXPackage`, enginesVscode: safeText(enginesVscode, 100), categories: Array.isArray(item.categories) ? item.categories.slice(0, 12).map((value) => safeText(value, 80)) : [], downloadCount: installs, ...compatibility });
  }
  async search(query: string, registry: ExtensionRegistry): Promise<ExtensionGalleryItem[]> {
    const needle = query.trim().slice(0, 200); let items: ExtensionGalleryItem[];
    if (registry === 'open-vsx') {
      const url = `${OPEN_VSX}/api/-/search?query=${encodeURIComponent(needle)}&size=${MAX_SEARCH_RESULTS}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Open VSX search failed (${response.status})`);
      const payload = await response.json() as { extensions?: OpenVsxItem[] }; items = (payload.extensions ?? []).map((item) => this.openVsxItem(item)).filter((item): item is ExtensionGalleryItem => Boolean(item));
    } else {
      const response = await fetch(`${VS_MARKETPLACE}/_apis/public/gallery/extensionquery`, { method: 'POST', headers: { Accept: 'application/json;api-version=3.0-preview.1', 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: [{ criteria: [{ filterType: 8, value: needle || 'Microsoft.VisualStudio.Code' }], pageNumber: 1, pageSize: MAX_SEARCH_RESULTS, sortBy: 4, sortOrder: 0 }], assetTypes: [], flags: 950 }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`VS Code Marketplace search failed (${response.status})`); const payload = await response.json() as { results?: Array<{ extensions?: MarketplaceExtension[] }> }; items = (payload.results?.[0]?.extensions ?? []).map((item) => this.marketplaceItem(item)).filter((item): item is ExtensionGalleryItem => Boolean(item));
    }
    return items;
  }
  async installedList(): Promise<InstalledExtension[]> { return [...this.installed.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  private async readVsixManifest(archive: string): Promise<Record<string, unknown>> {
    const command = process.platform === 'win32' ? 'tar' : 'unzip';
    const args = process.platform === 'win32' ? ['-xOf', archive, 'extension/package.json'] : ['-p', archive, 'extension/package.json'];
    const result = await execFileAsync(command, args, { maxBuffer: 2 * 1024 * 1024, windowsHide: true }).catch((error) => { throw new Error(`Invalid VSIX archive: ${error instanceof Error ? error.message : String(error)}`); });
    try { const manifest = JSON.parse(result.stdout) as Record<string, unknown>; if (!manifest.name || !manifest.publisher || !manifest.version || !manifest.engines || typeof manifest.engines !== 'object') throw new Error('VSIX manifest is missing name, publisher, version, or engines.vscode'); return manifest; }
    catch (error) { throw new Error(`Invalid VS Code extension manifest: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  private async validateArchiveEntries(archive: string): Promise<void> {
    const command = process.platform === 'win32' ? 'tar' : 'unzip';
    const args = process.platform === 'win32' ? ['-tf', archive] : ['-Z1', archive];
    const result = await execFileAsync(command, args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const entries = result.stdout.split(/\\r?\\n/).map((entry) => entry.trim()).filter(Boolean);
    if (!entries.some((entry) => entry === 'extension/package.json')) throw new Error('VSIX archive has no extension/package.json manifest.');
    if (entries.some((entry) => entry.startsWith('/') || /^[A-Za-z]:[\\\\/]/.test(entry) || entry.split(/[\\\\/]/).includes('..'))) throw new Error('VSIX archive contains an unsafe path.');
  }
  private async extractVsix(archive: string, destination: string): Promise<void> {
    await this.validateArchiveEntries(archive); await mkdir(destination, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') await execFileAsync('tar', ['-xf', archive, '-C', destination], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    else await execFileAsync('unzip', ['-q', '-o', archive, '-d', destination], { maxBuffer: 2 * 1024 * 1024 });
  }
  async install(item: ExtensionGalleryItem): Promise<InstalledExtension> {
    if (!item.compatible) throw new Error(item.compatibilityMessage || 'Extension is not compatible with the current BibzCode VS Code API target.');
    const response = await fetch(item.downloadUrl, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(60_000) }); if (!response.ok) throw new Error(`Extension download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > MAX_VSIX_BYTES) throw new Error('VSIX package exceeds the 100 MiB limit.');
    const tempArchive = path.join(os.tmpdir(), `bibzcode-${item.id.replace(/[^A-Za-z0-9_-]/g, '-')}-${Date.now()}.vsix`); const staging = path.join(os.tmpdir(), `bibzcode-extension-${Date.now()}`); const installPath = path.join(this.root, `${item.publisher}.${item.name}-${item.version}`);
    await writeFile(tempArchive, bytes, { mode: 0o600 });
    try {
      const manifest = await this.readVsixManifest(tempArchive); const publisher = safeText(manifest.publisher, 200); const name = safeText(manifest.name, 200); const version = safeText(manifest.version, 100); if (extensionId(publisher, name) !== item.id || version !== item.version) throw new Error('VSIX metadata does not match the selected registry item.');
      const engines = manifest.engines as Record<string, unknown>; const compatibility = compatibleWithVscode(safeText(engines.vscode, 100)); if (!compatibility.compatible) throw new Error(compatibility.message || 'VSIX engine is incompatible.');
      await this.extractVsix(tempArchive, staging); await rm(installPath, { recursive: true, force: true }); await mkdir(this.root, { recursive: true, mode: 0o700 }); await rename(path.join(staging, 'extension'), installPath);
      const installed: InstalledExtension = { id: item.id, publisher, name, displayName: safeText(manifest.displayName || item.displayName, 200), version, installPath, source: item.source, enginesVscode: safeText(engines.vscode, 100), enabled: true, installedAt: new Date().toISOString(), manifest };
      this.installed.set(item.id, installed); await this.persist(); return installed;
    } finally { await rm(tempArchive, { force: true }); await rm(staging, { recursive: true, force: true }); }
  }
  async installVsix(archive: string): Promise<InstalledExtension> {
    const info = await stat(archive).catch(() => null); if (!info?.isFile() || info.size > MAX_VSIX_BYTES) throw new Error('VSIX file is missing or exceeds the 100 MiB limit.');
    const manifest = await this.readVsixManifest(archive); const engines = manifest.engines as Record<string, unknown>; const compatibility = compatibleWithVscode(safeText(engines.vscode, 100)); if (!compatibility.compatible) throw new Error(compatibility.message || 'VSIX engine is incompatible.');
    const publisher = safeText(manifest.publisher, 200); const name = safeText(manifest.name, 200); const version = safeText(manifest.version, 100); if (!publisher || !name || !version) throw new Error('VSIX manifest has invalid identity.');
    const id = extensionId(publisher, name); const staging = path.join(os.tmpdir(), `bibzcode-vsix-${Date.now()}`); const installPath = path.join(this.root, `${publisher}.${name}-${version}`);
    try {
      await this.extractVsix(archive, staging); await rm(installPath, { recursive: true, force: true }); await mkdir(this.root, { recursive: true, mode: 0o700 }); await rename(path.join(staging, 'extension'), installPath);
      const installed: InstalledExtension = { id, publisher, name, displayName: safeText(manifest.displayName || name, 200), version, installPath, source: 'vsix', enginesVscode: safeText(engines.vscode, 100), enabled: true, installedAt: new Date().toISOString(), manifest };
      this.installed.set(id, installed); await this.persist(); return installed;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  async uninstall(id: string): Promise<void> { const current = this.installed.get(id); if (!current) return; await rm(current.installPath, { recursive: true, force: true }); this.installed.delete(id); await this.persist(); }
  async setEnabled(id: string, enabled: boolean): Promise<InstalledExtension> { const current = this.installed.get(id); if (!current) throw new Error('Extension is not installed.'); const updated = { ...current, enabled }; this.installed.set(id, updated); await this.persist(); return updated; }
}
