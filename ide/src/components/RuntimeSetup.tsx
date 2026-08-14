import { useEffect, useState } from 'react';
import { CheckCircle2, Download, X } from 'lucide-react';
import { friendlyError } from '../lib';

export function RuntimeSetup({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (message: string) => void }) {
  const [output, setOutput] = useState('');
  const [activeId, setActiveId] = useState('');
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const offData = window.bibzIDE.runtime.onData((event) => { if (!activeId || activeId === event.sessionId) setOutput((value) => `${value}${event.data}`); });
    const offExit = window.bibzIDE.runtime.onExit((event) => { if (!activeId || activeId === event.sessionId) { setActiveId(''); setSuccess(event.code === 0); } });
    return () => { offData(); offExit(); };
  }, [activeId]);
  if (!open) return null;
  const setup = async (full: boolean) => {
    setOutput(''); setSuccess(false);
    try { setActiveId(await window.bibzIDE.runtime.setup(full)); }
    catch (error) { onError(friendlyError(error)); }
  };
  return <div className="modal-backdrop"><section className="runtime-modal" role="dialog" aria-modal="true" aria-labelledby="runtime-title">
    <header><div><Download /><div><h2 id="runtime-title">Managed BibzCode Runtime</h2><p>Create an isolated venv under the IDE data directory using hash-locked dependencies.</p></div></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="runtime-options"><button disabled={Boolean(activeId)} onClick={() => void setup(false)}><strong>Core runtime</strong><span>86 tools, providers, sessions, memory and document essentials.</span></button><button disabled={Boolean(activeId)} onClick={() => void setup(true)}><strong>Full feature parity</strong><span>Core plus browser, Selenium, MCP, plotting and all 115 tools.</span></button></div>
    <pre className="runtime-output">{output || 'Choose a runtime profile. Python 3.10+ and an internet connection are required for the initial locked dependency install.'}</pre>
    {success && <div className="success-banner"><CheckCircle2 /> Runtime setup completed and verified.</div>}
    <footer><button className="secondary-button" onClick={onClose} disabled={Boolean(activeId)}>Close</button></footer>
  </section></div>;
}
