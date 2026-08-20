import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, RefreshCw, Trash2, X } from 'lucide-react';
import type { FileEntry } from '../../shared/contracts';
import { friendlyError } from '../lib';

interface ExplorerProps { root: string; refreshToken: number; onOpen: (relativePath: string) => void; onError: (message: string) => void; onRefresh: () => void }

type CreateKind = 'file' | 'directory';

function TreeNode({ entry, depth, refreshToken, onOpen, onError, onRefresh }: { entry: FileEntry; depth: number; refreshToken: number; onOpen: (path: string) => void; onError: (message: string) => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  useEffect(() => {
    if (expanded && entry.kind === 'directory') void window.bibzIDE.workspace.list(entry.relativePath).then(setChildren).catch((error) => onError(friendlyError(error)));
  }, [expanded, entry.kind, entry.relativePath, onError, refreshToken]);
  const activate = () => { if (entry.kind === 'directory') setExpanded((value) => !value); else if (entry.kind === 'file') onOpen(entry.relativePath); };
  const trash = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm(`Move ${entry.relativePath} to the system trash?`)) return;
    try { await window.bibzIDE.file.trash(entry.relativePath); onRefresh(); } catch (error) { onError(friendlyError(error)); }
  };
  return <>
    <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={activate} role="treeitem" aria-expanded={entry.kind === 'directory' ? expanded : undefined}>
      <span className="tree-chevron">{entry.kind === 'directory' ? expanded ? <ChevronDown /> : <ChevronRight /> : null}</span>
      <span className="tree-icon">{entry.kind === 'directory' ? expanded ? <FolderOpen /> : <Folder /> : <File />}</span>
      <span className="tree-name" title={entry.relativePath}>{entry.name}</span>
      <button className="icon-button tree-action" title="Move to trash" onClick={trash}><Trash2 /></button>
    </div>
    {expanded && children.map((child) => <TreeNode key={child.relativePath} entry={child} depth={depth + 1} refreshToken={refreshToken} onOpen={onOpen} onError={onError} onRefresh={onRefresh} />)}
  </>;
}

export function Explorer({ root, refreshToken, onOpen, onError, onRefresh }: ExplorerProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    if (!root) { setEntries([]); return; }
    void window.bibzIDE.workspace.list('').then(setEntries).catch((error) => onError(friendlyError(error)));
  }, [onError, root]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load, refreshToken]);

  const openCreate = (kind: CreateKind) => { if (!root) { onError('Open a workspace folder before creating files.'); return; } setCreateKind(kind); setCreateName(''); };
  const closeCreate = () => { if (!creating) { setCreateKind(null); setCreateName(''); } };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); const name = createName.trim(); if (!createKind || !name) return;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..')) { onError('Use a workspace-relative path without absolute or parent traversal segments.'); return; }
    setCreating(true);
    try { await window.bibzIDE.file.create(name, createKind); closeCreate(); onRefresh(); load(); }
    catch (error) { onError(friendlyError(error)); }
    finally { setCreating(false); }
  };

  return <section className="side-view explorer-view">
    <div className="side-heading"><span>EXPLORER</span><div className="side-actions">
      <button className="icon-button" title="New file" aria-label="New file" onClick={() => openCreate('file')}><FilePlus2 /></button>
      <button className="icon-button" title="New folder" aria-label="New folder" onClick={() => openCreate('directory')}><FolderPlus /></button>
      <button className="icon-button" title="Refresh" aria-label="Refresh explorer" onClick={() => { load(); onRefresh(); }}><RefreshCw /></button>
    </div></div>
    <div className="workspace-label" title={root}>{root ? root.split(/[\\/]/).pop() : 'NO FOLDER OPEN'}</div>
    <div className="tree" role="tree">
      {root ? entries.map((entry) => <TreeNode key={entry.relativePath} entry={entry} depth={0} refreshToken={refreshToken} onOpen={onOpen} onError={onError} onRefresh={onRefresh} />) : <p className="empty-copy">Open a folder to browse files.</p>}
    </div>
    {createKind && <div className="create-backdrop" role="presentation" onMouseDown={closeCreate}>
      <form className="create-dialog" onSubmit={(event) => void create(event)} onMouseDown={(event) => event.stopPropagation()}>
        <header><strong>{createKind === 'file' ? 'New File' : 'New Folder'}</strong><button type="button" className="icon-button" title="Cancel" onClick={closeCreate}><X /></button></header>
        <label>Workspace-relative path<input autoFocus value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder={createKind === 'file' ? 'src/example.ts' : 'src/components'} disabled={creating} /></label>
        <footer><button type="button" className="secondary-button" onClick={closeCreate} disabled={creating}>Cancel</button><button className="primary-button" type="submit" disabled={creating || !createName.trim()}>{creating ? 'Creating…' : `Create ${createKind === 'file' ? 'file' : 'folder'}`}</button></footer>
      </form>
    </div>}
  </section>;
}
