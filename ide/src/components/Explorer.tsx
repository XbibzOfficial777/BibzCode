import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, FilePlus2, Folder, FolderOpen, FolderPlus, RefreshCw, Trash2 } from 'lucide-react';
import type { FileEntry } from '../../shared/contracts';
import { friendlyError, joinRelative } from '../lib';

interface ExplorerProps {
  root: string;
  refreshToken: number;
  onOpen: (relativePath: string) => void;
  onError: (message: string) => void;
  onRefresh: () => void;
}

function TreeNode({ entry, depth, refreshToken, onOpen, onError, onRefresh }: {
  entry: FileEntry; depth: number; refreshToken: number; onOpen: (path: string) => void;
  onError: (message: string) => void; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  useEffect(() => {
    if (expanded && entry.kind === 'directory') {
      window.bibzIDE.workspace.list(entry.relativePath).then(setChildren).catch((error) => onError(friendlyError(error)));
    }
  }, [expanded, entry.kind, entry.relativePath, onError, refreshToken]);

  const activate = () => {
    if (entry.kind === 'directory') setExpanded((value) => !value);
    else if (entry.kind === 'file') onOpen(entry.relativePath);
  };
  const trash = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm(`Move ${entry.relativePath} to the system trash?`)) return;
    try { await window.bibzIDE.file.trash(entry.relativePath); onRefresh(); }
    catch (error) { onError(friendlyError(error)); }
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
  const load = useCallback(() => {
    if (!root) return;
    void window.bibzIDE.workspace.list('').then(setEntries).catch((error) => onError(friendlyError(error)));
  }, [onError, root]);
  useEffect(() => { load(); }, [load, refreshToken]);

  const create = async (kind: 'file' | 'directory') => {
    const label = kind === 'file' ? 'file' : 'folder';
    const name = prompt(`New ${label} path (relative to workspace):`);
    if (!name) return;
    try { await window.bibzIDE.file.create(joinRelative('', name), kind); onRefresh(); }
    catch (error) { onError(friendlyError(error)); }
  };

  return <section className="side-view explorer-view">
    <div className="side-heading"><span>EXPLORER</span><div className="side-actions">
      <button className="icon-button" title="New file" onClick={() => void create('file')}><FilePlus2 /></button>
      <button className="icon-button" title="New folder" onClick={() => void create('directory')}><FolderPlus /></button>
      <button className="icon-button" title="Refresh" onClick={() => { load(); onRefresh(); }}><RefreshCw /></button>
    </div></div>
    <div className="workspace-label" title={root}>{root ? root.split(/[\\/]/).pop() : 'NO FOLDER OPEN'}</div>
    <div className="tree" role="tree">
      {root ? entries.map((entry) => <TreeNode key={entry.relativePath} entry={entry} depth={0} refreshToken={refreshToken} onOpen={onOpen} onError={onError} onRefresh={onRefresh} />) : <p className="empty-copy">Open a folder to browse files.</p>}
    </div>
  </section>;
}
