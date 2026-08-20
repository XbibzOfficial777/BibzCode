import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, ExternalLink, PackageOpen, Play, Power, RefreshCw, Search, ShieldAlert, ShieldCheck, Square, Trash2, Upload, X } from 'lucide-react';
import type { ExtensionGalleryItem, ExtensionRuntimeEvent, ExtensionRuntimeStatus, InstalledExtension } from '../../shared/contracts';
import { friendlyError } from '../lib';

type Registry = 'open-vsx' | 'vscode-marketplace';
type Mode = 'browse' | 'installed';

export function ExtensionsView({ onError }: { onError: (message: string) => void }) {
  const [registry, setRegistry] = useState<Registry>('open-vsx');
  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ExtensionGalleryItem[]>([]);
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [selected, setSelected] = useState<ExtensionGalleryItem | null>(null);
  const [runtime, setRuntime] = useState<ExtensionRuntimeStatus[]>([]);
  const [runtimeMessage, setRuntimeMessage] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);

  const loadInstalled = useCallback(async () => {
    try { setInstalled(await window.bibzIDE.extensions.installed()); setRuntime(await window.bibzIDE.extensions.runtimeStatus()); } catch (error) { onError(friendlyError(error)); }
  }, [onError]);
  const search = useCallback(async () => {
    if (mode === 'installed') return;
    setLoading(true);
    try { setItems(await window.bibzIDE.extensions.search(query, registry)); }
    catch (error) { onError(friendlyError(error)); }
    finally { setLoading(false); }
  }, [mode, onError, query, registry]);
  useEffect(() => { const timer = window.setTimeout(() => void loadInstalled(), 0); return () => window.clearTimeout(timer); }, [loadInstalled]);
  useEffect(() => { const timer = window.setTimeout(() => void search(), 350); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => window.bibzIDE.extensions.onRuntimeEvent((event: ExtensionRuntimeEvent) => {
    if (event.status) setRuntime((current) => [...current.filter((value) => value.id !== event.id), event.status!]);
    if (event.message) setRuntimeMessage((current) => ({ ...current, [event.id]: event.message! }));
  }), []);

  const installedMap = useMemo(() => new Map(installed.map((item) => [item.id, item])), [installed]);
  const runtimeMap = useMemo(() => new Map(runtime.map((item) => [item.id, item])), [runtime]);
  const install = async (item: ExtensionGalleryItem) => {
    if (!item.compatible) { onError(item.compatibilityMessage || 'This extension is not compatible with the current BibzCode API target.'); return; }
    setBusy(`install:${item.id}`);
    try { const result = await window.bibzIDE.extensions.install(item); setInstalled((current) => [...current.filter((value) => value.id !== result.id), result]); setSelected({ ...item, installedVersion: result.version, enabled: result.enabled }); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const installVsix = async () => {
    setBusy('vsix');
    try { const result = await window.bibzIDE.extensions.installVsix(); if (result) { setInstalled((current) => [...current.filter((value) => value.id !== result.id), result]); setMode('installed'); setSelected(null); } }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const uninstall = async (id: string) => {
    setBusy(`uninstall:${id}`);
    try { await window.bibzIDE.extensions.uninstall(id); setInstalled((current) => current.filter((value) => value.id !== id)); setSelected(null); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const toggle = async (item: InstalledExtension) => {
    setBusy(`toggle:${item.id}`);
    try { const updated = await window.bibzIDE.extensions.setEnabled(item.id, !item.enabled); setInstalled((current) => current.map((value) => value.id === updated.id ? updated : value)); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const setTrust = async (item: InstalledExtension, trust: 'trusted' | 'untrusted') => {
    setBusy(`trust:${item.id}`);
    try { const updated = await window.bibzIDE.extensions.setTrust(item.id, trust); setInstalled((current) => current.map((value) => value.id === updated.id ? updated : value)); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const startRuntime = async (item: InstalledExtension) => {
    setBusy(`start:${item.id}`);
    try { const status = await window.bibzIDE.extensions.runtimeStart(item.id); setRuntime((current) => [...current.filter((value) => value.id !== item.id), status]); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const stopRuntime = async (item: InstalledExtension) => {
    setBusy(`stop:${item.id}`);
    try { await window.bibzIDE.extensions.runtimeStop(item.id); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const executeCommand = async (item: InstalledExtension, command: string) => {
    setBusy(`command:${item.id}:${command}`);
    try { await window.bibzIDE.extensions.runtimeCommand(item.id, command); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };

  const browseItems = mode === 'installed' ? installed.map((item) => ({ id: item.id, publisher: item.publisher, name: item.name, displayName: item.displayName, version: item.version, description: String(item.manifest.description ?? ''), source: item.source === 'vsix' ? 'open-vsx' as const : item.source, downloadUrl: '', enginesVscode: item.enginesVscode, categories: Array.isArray(item.manifest.categories) ? item.manifest.categories.filter((value): value is string => typeof value === 'string') : [], compatible: true, installedVersion: item.version, enabled: item.enabled })) : items;
  const currentInstalled = selected ? installedMap.get(selected.id) : undefined;
  const currentRuntime = currentInstalled ? runtimeMap.get(currentInstalled.id) : undefined;

  return <section className="side-view extensions-view">
    <div className="side-heading"><span>EXTENSIONS</span><div className="side-actions"><button className="icon-button" title="Install from VSIX" aria-label="Install from VSIX" onClick={() => void installVsix()} disabled={Boolean(busy)}><Upload /></button><button className="icon-button" title="Refresh extensions" aria-label="Refresh extensions" onClick={() => { void loadInstalled(); void search(); }}><RefreshCw /></button></div></div>
    <div className="extensions-toolbar"><div className="extensions-tabs"><button className={mode === 'browse' ? 'active' : ''} onClick={() => setMode('browse')}>Marketplace</button><button className={mode === 'installed' ? 'active' : ''} onClick={() => setMode('installed')}>Installed ({installed.length})</button></div><div className="extension-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extensions" aria-label="Search extensions" /><button className="icon-button" title="Clear search" onClick={() => setQuery('')} disabled={!query}><X /></button></div>{mode === 'browse' && <select className="extension-registry" value={registry} onChange={(event) => setRegistry(event.target.value as Registry)} aria-label="Extension registry"><option value="open-vsx">Open VSX</option><option value="vscode-marketplace">VS Code Marketplace</option></select>}</div>
    <div className="extensions-body"><div className="extension-list">{loading && <p className="inline-status">Loading extensions…</p>}{!loading && browseItems.length === 0 && <p className="empty-copy">{mode === 'installed' ? 'No extensions installed.' : 'No extensions found.'}</p>}{browseItems.map((item) => { const isInstalled = Boolean(installedMap.get(item.id)); const installedValue = installedMap.get(item.id); return <button className={`extension-card ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item)}><span className="extension-card-icon"><PackageOpen /></span><span className="extension-card-copy"><strong>{item.displayName}</strong><small>{item.publisher}.{item.name}</small><span>{item.description || 'VS Code-compatible extension'}</span></span><span className={`extension-state ${isInstalled ? 'installed' : ''}`}>{isInstalled ? installedValue?.enabled === false ? 'Disabled' : 'Installed' : item.version}</span></button>; })}</div>
      {selected && <article className="extension-detail"><header><div><h3>{selected.displayName}</h3><p>{selected.publisher}.{selected.name} · v{selected.version}</p></div><button className="icon-button" title="Close details" aria-label="Close details" onClick={() => setSelected(null)}><X /></button></header><p className="extension-description">{selected.description || 'No description provided.'}</p><div className="extension-meta"><span>Registry: {selected.source}</span><span>VS Code engine: {selected.enginesVscode || 'not declared'}</span><span>Compatibility: {selected.compatible ? 'supported target' : selected.compatibilityMessage || 'unsupported'}</span></div>{selected.categories.length > 0 && <div className="extension-tags">{selected.categories.map((category) => <span key={category}>{category}</span>)}</div>}
        <div className="extension-detail-actions">{currentInstalled ? <><button className="secondary-button" onClick={() => void toggle(currentInstalled)} disabled={Boolean(busy)}><Power /> {currentInstalled.enabled ? 'Disable' : 'Enable'}</button><button className="secondary-button danger-button" onClick={() => void uninstall(currentInstalled.id)} disabled={Boolean(busy)}><Trash2 /> Uninstall</button></> : <button className="primary-button" onClick={() => void install(selected)} disabled={Boolean(busy) || !selected.compatible}><Download /> {busy === `install:${selected.id}` ? 'Installing…' : 'Install'}</button>}{selected.readmeUrl && <button className="secondary-button" onClick={() => void window.bibzIDE.app.openExternal(selected.readmeUrl!)}><ExternalLink /> Readme</button>}</div>
        {currentInstalled && <><div className={`extension-trust ${currentInstalled.trust}`}><div><strong>{currentInstalled.trust === 'trusted' ? <ShieldCheck /> : <ShieldAlert />} {currentInstalled.trust === 'trusted' ? 'Trusted for activation' : 'Activation blocked until trusted'}</strong>{currentInstalled.risk.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div><button className="secondary-button" onClick={() => void setTrust(currentInstalled, currentInstalled.trust === 'trusted' ? 'untrusted' : 'trusted')} disabled={Boolean(busy)}>{currentInstalled.trust === 'trusted' ? 'Revoke trust' : 'Trust extension'}</button></div>
          {currentInstalled.risk.nativeBinaries.length > 0 && <pre className="extension-risk-files">Native files: {currentInstalled.risk.nativeBinaries.join(', ')}</pre>}
          {currentInstalled.risk.hasMainEntry && <div className="extension-runtime"><div className="extension-runtime-heading"><strong>Guarded extension runtime</strong><span className={`runtime-state ${currentRuntime?.state ?? 'stopped'}`}>{currentRuntime?.state ?? 'stopped'}</span></div><p>{runtimeMessage[currentInstalled.id] || currentRuntime?.message || 'Runtime is stopped. Activation requires explicit trust.'}</p><div className="extension-detail-actions">{currentRuntime?.state === 'running' ? <button className="secondary-button" onClick={() => void stopRuntime(currentInstalled)} disabled={Boolean(busy)}><Square /> Stop host</button> : <button className="primary-button" onClick={() => void startRuntime(currentInstalled)} disabled={Boolean(busy) || currentInstalled.trust !== 'trusted' || !currentInstalled.enabled}><Play /> Start host</button>}{currentRuntime?.commands.map((command) => <button className="secondary-button" key={command} onClick={() => void executeCommand(currentInstalled, command)} disabled={Boolean(busy)}><Play /> {command}</button>)}</div></div>}
        </>}</>}
        {!currentInstalled && <p className="secure-note"><Check /> Extensions are scanned during installation. Executable extensions remain untrusted until explicitly approved.</p>}
      </article>}
    </div>
  </section>;
}
