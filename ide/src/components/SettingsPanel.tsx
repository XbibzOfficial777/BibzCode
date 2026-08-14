import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { IdeSettings, RuntimeStatus } from '../../shared/contracts';
import { friendlyError } from '../lib';

export function SettingsPanel({ onError, onRuntimeSetup }: { onError: (message: string) => void; onRuntimeSetup: () => void }) {
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const load = useCallback(() => {
    void window.bibzIDE.settings.get().then(setSettings).catch((error) => onError(friendlyError(error)));
    void window.bibzIDE.runtime.status().then(setRuntime).catch((error) => onError(friendlyError(error)));
  }, [onError]);
  useEffect(() => { load(); }, [load]);
  if (!settings) return <section className="side-view"><div className="side-heading">SETTINGS</div><p className="empty-copy">Loading…</p></section>;
  const update = <K extends keyof IdeSettings>(key: K, value: IdeSettings[K]) => setSettings({ ...settings, [key]: value });
  const save = async () => {
    try { setSettings(await window.bibzIDE.settings.set(settings)); load(); }
    catch (error) { onError(friendlyError(error)); }
  };
  return <section className="side-view settings-view">
    <div className="side-heading"><span>SETTINGS</span><button className="icon-button" onClick={load}><RefreshCw /></button></div>
    <label>Python executable<input value={settings.pythonPath} onChange={(e) => update('pythonPath', e.target.value)} placeholder="Auto-detect" /></label>
    <label>Shell executable<input value={settings.shellPath} onChange={(e) => update('shellPath', e.target.value)} placeholder="System default" /></label>
    <label>Editor font size<input type="number" min={10} max={28} value={settings.editorFontSize} onChange={(e) => update('editorFontSize', Number(e.target.value))} /></label>
    <label>Word wrap<select value={settings.wordWrap} onChange={(e) => update('wordWrap', e.target.value as 'on' | 'off')}><option value="off">Off</option><option value="on">On</option></select></label>
    <label>Theme<select value={settings.theme} onChange={(e) => update('theme', e.target.value as IdeSettings['theme'])}><option value="bibz-dark">Bibz Dark</option><option value="high-contrast">High Contrast</option></select></label>
    <label className="check-label"><input type="checkbox" checked={settings.autoUpdate} onChange={(e) => update('autoUpdate', e.target.checked)} /> Check for updates</label>
    <label className="check-label"><input type="checkbox" checked={settings.confirmBeforeDelete} onChange={(e) => update('confirmBeforeDelete', e.target.checked)} /> Confirm before trash</label>
    <button className="primary-button" onClick={() => void save()}><Check /> Save settings</button>
    <div className={`runtime-card state-${runtime?.state ?? 'checking'}`}><strong>BibzCode runtime</strong><span>{runtime?.message ?? 'Checking…'}</span><code>{runtime?.pythonVersion ? `Python ${runtime.pythonVersion}` : ''}</code><button onClick={onRuntimeSetup}>Managed setup…</button></div>
  </section>;
}
