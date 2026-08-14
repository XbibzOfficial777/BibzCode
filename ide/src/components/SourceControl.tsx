import { useCallback, useEffect, useState } from 'react';
import { Check, Minus, Plus, RefreshCw } from 'lucide-react';
import type { GitFileStatus } from '../../shared/contracts';
import { friendlyError } from '../lib';

export function SourceControl({ root, refreshToken, onDiff, onError, onRefresh }: {
  root: string; refreshToken: number; onDiff: (label: string, content: string) => void; onError: (message: string) => void; onRefresh: () => void;
}) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [message, setMessage] = useState('');
  const load = useCallback(() => {
    if (!root) return;
    void window.bibzIDE.git.status().then(setFiles).catch((error) => onError(friendlyError(error)));
  }, [onError, root]);
  useEffect(() => { load(); }, [load, refreshToken]);
  const diff = async (file: GitFileStatus) => {
    try { onDiff(`diff · ${file.relativePath}`, await window.bibzIDE.git.diff(file.relativePath, false)); }
    catch (error) { onError(friendlyError(error)); }
  };
  const stage = async (file: GitFileStatus) => {
    try { await window.bibzIDE.git.stage(file.relativePath); load(); onRefresh(); }
    catch (error) { onError(friendlyError(error)); }
  };
  const unstage = async (file: GitFileStatus) => {
    try { await window.bibzIDE.git.unstage(file.relativePath); load(); onRefresh(); }
    catch (error) { onError(friendlyError(error)); }
  };
  const commit = async () => {
    try { await window.bibzIDE.git.commit(message); setMessage(''); load(); onRefresh(); }
    catch (error) { onError(friendlyError(error)); }
  };
  return <section className="side-view">
    <div className="side-heading"><span>SOURCE CONTROL</span><button className="icon-button" onClick={load}><RefreshCw /></button></div>
    <div className="commit-box"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" maxLength={500} />
      <button className="primary-button" disabled={!message.trim()} onClick={() => void commit()}><Check /> Commit</button></div>
    <div className="scm-list">
      {files.map((file) => {
        const staged = file.code[0] !== ' ' && file.code[0] !== '?';
        return <div className="scm-row" key={`${file.code}:${file.relativePath}`}>
          <button className="scm-file" onClick={() => void diff(file)}><span>{file.relativePath}</span><code>{file.code}</code></button>
          <button className="icon-button" title={staged ? 'Unstage' : 'Stage'} onClick={() => void (staged ? unstage(file) : stage(file))}>{staged ? <Minus /> : <Plus />}</button>
        </div>;
      })}
      {!files.length && <p className="empty-copy">{root ? 'No source control changes.' : 'Open a Git workspace.'}</p>}
    </div>
  </section>;
}
