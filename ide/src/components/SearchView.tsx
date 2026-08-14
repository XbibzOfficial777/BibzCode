import { useState } from 'react';
import { Search } from 'lucide-react';
import type { SearchMatch } from '../../shared/contracts';
import { friendlyError } from '../lib';

export function SearchView({ root, onOpen, onError }: { root: string; onOpen: (path: string, line?: number) => void; onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!query.trim() || !root) return;
    setBusy(true);
    try { setMatches(await window.bibzIDE.workspace.search(query)); }
    catch (error) { onError(friendlyError(error)); }
    finally { setBusy(false); }
  };
  return <section className="side-view">
    <div className="side-heading"><span>SEARCH</span></div>
    <form className="search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspace" aria-label="Search workspace" />
      <button className="icon-button" title="Search" disabled={busy || !root}><Search /></button>
    </form>
    <div className="search-summary">{busy ? 'Searching…' : matches.length ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : 'No results'}</div>
    <div className="search-results">
      {matches.map((match, index) => <button key={`${match.relativePath}:${match.line}:${index}`} onClick={() => onOpen(match.relativePath, match.line)}>
        <strong>{match.relativePath}</strong><span>{match.line}:{match.column} · {match.preview}</span>
      </button>)}
    </div>
  </section>;
}
