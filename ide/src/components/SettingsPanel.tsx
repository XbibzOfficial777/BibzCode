import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, RefreshCw, Server, ShieldCheck, Sparkles, TestTube2 } from 'lucide-react';
import type { AiProvider, IdeSettings } from '../../shared/contracts';
import { PROVIDER_PRESETS, providerPreset } from '../../shared/provider-catalog';
import { friendlyError } from '../lib';

export function SettingsPanel({ onError, onSettingsChange }: { onError: (message: string) => void; onSettingsChange: (settings: IdeSettings) => void }) {
  const [settings, setSettings] = useState<IdeSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [secretDirty, setSecretDirty] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [probe, setProbe] = useState('');
  const [busy, setBusy] = useState<'save' | 'probe' | 'models' | 'compress' | ''>('');
  const [compressionInput, setCompressionInput] = useState('');
  const [compressionReport, setCompressionReport] = useState('');

  const load = useCallback(() => {
    void window.bibzIDE.settings.get().then(setSettings).catch((error) => onError(friendlyError(error)));
    void window.bibzIDE.secrets.status().then((status) => setSecretConfigured(status.configured)).catch((error) => onError(friendlyError(error)));
  }, [onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!secretDirty) return undefined;
    const timer = window.setTimeout(() => {
      void (apiKey.trim() ? window.bibzIDE.secrets.set(apiKey) : window.bibzIDE.secrets.clear())
        .then((result) => { setSecretConfigured(result.configured); setSecretDirty(false); })
        .catch((error) => onError(friendlyError(error)));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [apiKey, onError, secretDirty]);
  if (!settings) return <section className="side-view"><div className="side-heading">SETTINGS</div><p className="empty-copy">Loading…</p></section>;

  const apply = (next: IdeSettings) => { setSettings(next); onSettingsChange(next); void window.bibzIDE.settings.set(next).catch((error) => onError(friendlyError(error))); };
  const update = <K extends keyof IdeSettings>(key: K, value: IdeSettings[K]) => apply({ ...settings, [key]: value });
  const persistSecret = async () => {
    if (!secretDirty) return;
    const result = apiKey.trim() ? await window.bibzIDE.secrets.set(apiKey) : await window.bibzIDE.secrets.clear();
    setSecretConfigured(result.configured);
    setSecretDirty(false);
  };
  const save = async () => {
    setBusy('save');
    try { await persistSecret(); setSettings(await window.bibzIDE.settings.set(settings)); setProbe('Settings saved to the native userData store.'); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(''); }
  };
  const testConnection = async () => {
    setBusy('probe');
    try { await persistSecret(); await window.bibzIDE.settings.set(settings); const result = await window.bibzIDE.agent.probe(); setProbe(`${result.ok ? 'Connected' : 'Failed'} — ${result.message} (${result.latencyMs} ms)`); }
    catch (error) { setProbe(`Failed — ${friendlyError(error)}`); }
    finally { setBusy(''); }
  };
  const discoverModels = async () => {
    setBusy('models');
    try { await persistSecret(); await window.bibzIDE.settings.set(settings); setModels(await window.bibzIDE.agent.models()); setProbe('Model discovery completed.'); }
    catch (error) { setProbe(`Model discovery failed — ${friendlyError(error)}`); }
    finally { setBusy(''); }
  };
  const testCompression = async () => {
    setBusy('compress');
    try { const result = await window.bibzIDE.agent.compress(compressionInput, settings.compressionContextWindow * 4); setCompressionReport(`${result.originalChars.toLocaleString()} → ${result.compressedChars.toLocaleString()} chars; ratio ${(result.ratio * 100).toFixed(1)}%; preserved blocks ${result.preservedBlocks}.`); }
    catch (error) { setCompressionReport(`Compression failed — ${friendlyError(error)}`); }
    finally { setBusy(''); }
  };
  const changeProvider = (provider: AiProvider) => { const preset = providerPreset(provider); apply({ ...settings, aiProvider: provider, aiBaseUrl: provider === 'custom' ? settings.aiBaseUrl : preset.baseUrl, aiModel: provider === 'custom' ? settings.aiModel : preset.defaultModel }); };
  const knownModels = [...new Set([...providerPreset(settings.aiProvider).models, ...models])];

  return <section className="side-view settings-view">
    <div className="side-heading"><span>AI CONTROL CENTER</span><button className="icon-button" title="Reload settings" onClick={load}><RefreshCw /></button></div>
    <div className="settings-section"><div className="section-title"><Sparkles /> Provider and model</div>
      <label>Provider<select value={settings.aiProvider} onChange={(e) => changeProvider(e.target.value as AiProvider)}>{PROVIDER_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}{preset.local ? ' (local)' : ''}</option>)}</select></label>
      <label>Base URL<input value={settings.aiBaseUrl} onChange={(e) => update('aiBaseUrl', e.target.value)} spellCheck={false} /></label>
      <label>Model<input list="bibz-model-list" value={settings.aiModel} onChange={(e) => update('aiModel', e.target.value)} spellCheck={false} /><datalist id="bibz-model-list">{knownModels.map((model) => <option key={model} value={model} />)}</datalist></label>
      <div className="button-row"><button className="secondary-button" onClick={() => void discoverModels()} disabled={Boolean(busy)}><Server /> {busy === 'models' ? 'Discovering…' : 'Discover models'}</button><button className="secondary-button" onClick={() => void testConnection()} disabled={Boolean(busy)}><TestTube2 /> {busy === 'probe' ? 'Testing…' : 'Test connection'}</button></div>
      <label>API key<input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setSecretDirty(true); }} placeholder={secretConfigured ? 'Stored in OS secure storage' : 'Enter provider key'} autoComplete="off" /></label>
      <div className="secure-note"><ShieldCheck /> {secretConfigured ? 'API key is encrypted by Electron safeStorage.' : 'No API key stored; Ollama can run locally without one.'}</div>
      {probe && <p className="inline-status">{probe}</p>}
    </div>
    <div className="settings-section"><div className="section-title"><Sparkles /> Thinking and context</div>
      <label className="check-label"><input type="checkbox" checked={settings.thinkingEnabled} onChange={(e) => update('thinkingEnabled', e.target.checked)} /> Enable reasoning controls</label>
      <label>Thinking mode<select value={settings.thinkingMode} onChange={(e) => update('thinkingMode', e.target.value as IdeSettings['thinkingMode'])}><option value="off">Off</option><option value="fast">Fast</option><option value="balanced">Balanced</option><option value="deep">Deep</option><option value="adaptive">Adaptive</option></select></label>
      <label>Thinking budget (tokens)<input type="number" min={0} max={200000} step={256} value={settings.thinkingBudget} onChange={(e) => update('thinkingBudget', Number(e.target.value))} /></label>
      <label>Compression mode<select value={settings.compressionMode} onChange={(e) => update('compressionMode', e.target.value as IdeSettings['compressionMode'])}><option value="off">Off</option><option value="balanced">Balanced</option><option value="ultra">Ultra deterministic</option></select></label>
      <label>Context window (tokens)<input type="number" min={4096} max={1000000} step={4096} value={settings.compressionContextWindow} onChange={(e) => update('compressionContextWindow', Number(e.target.value))} /></label>
      <label className="check-label"><input type="checkbox" checked={settings.compressionPreserveCode} onChange={(e) => update('compressionPreserveCode', e.target.checked)} /> Preserve code, diagnostics, and diffs</label>
      <textarea value={compressionInput} onChange={(e) => setCompressionInput(e.target.value)} placeholder="Paste context to measure deterministic compression…" rows={4} />
      <button className="secondary-button" onClick={() => void testCompression()} disabled={!compressionInput || Boolean(busy)}><TestTube2 /> {busy === 'compress' ? 'Compressing…' : 'Run compression test'}</button>
      {compressionReport && <p className="inline-status">{compressionReport}</p>}
    </div>
    <div className="settings-section"><div className="section-title"><KeyRound /> Editor and application</div>
      <label>Shell executable<input value={settings.shellPath} onChange={(e) => update('shellPath', e.target.value)} placeholder="System default" /></label>
      <label>Editor font size<input type="number" min={10} max={32} value={settings.editorFontSize} onChange={(e) => update('editorFontSize', Number(e.target.value))} /></label>
      <label>Word wrap<select value={settings.wordWrap} onChange={(e) => update('wordWrap', e.target.value as 'on' | 'off')}><option value="off">Off</option><option value="on">On</option></select></label>
      <label>Theme<select value={settings.theme} onChange={(e) => update('theme', e.target.value as IdeSettings['theme'])}><option value="bibz-dark">Bibz Dark</option><option value="bibz-light">Bibz Light</option><option value="high-contrast">High Contrast</option><option value="system">System</option></select></label>
      <label className="check-label"><input type="checkbox" checked={settings.autoUpdate} onChange={(e) => update('autoUpdate', e.target.checked)} /> Check for updates</label>
      <label className="check-label"><input type="checkbox" checked={settings.confirmBeforeDelete} onChange={(e) => update('confirmBeforeDelete', e.target.checked)} /> Confirm before trash</label>
      <button className="primary-button" onClick={() => void save()} disabled={Boolean(busy)}><Check /> {busy === 'save' ? 'Saving…' : 'Save settings'}</button>
      <div className="secure-note"><ShieldCheck /> The IDE runs natively with Electron and the configured provider; Python is not required for AI features.</div>
    </div>
  </section>;
}
