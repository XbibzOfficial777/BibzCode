import { Bot, Braces, Cable, Database, FileArchive, Globe2, MessagesSquare, Network, ShieldCheck, Sparkles, Wrench } from 'lucide-react';

const groups = [
  ['34 AI provider presets', 'OpenAI-compatible gateways, Anthropic, Google Gemini, local Ollama/LM Studio/vLLM, Agnes AI and custom endpoints', <Bot />],
  ['Monaco workbench', 'Syntax highlighting, language workers, minimap, themes, tabs, search, diff and editor commands', <Sparkles />],
  ['Workspace intelligence', 'Read, search, edit, diff and reason over the currently opened project through the native bridge', <Braces />],
  ['Streaming Agent', 'Real-time provider deltas, cancelable requests, thinking budgets and deterministic context compression', <Wrench />],
  ['Extension compatibility', 'VS Code-compatible extension foundation with a native Electron security boundary', <Cable />],
  ['Documents & media', 'Native workspace support for code and project files with terminal-based developer workflows', <FileArchive />],
  ['MCP-ready boundary', 'External tool connectors can be integrated through explicit, approved native adapters', <Globe2 />],
  ['Sessions & settings', 'Persisted provider, model, theme, editor and compression settings in the OS user data directory', <Database />],
  ['Remote connectors', 'Provider endpoints remain configurable without a web dashboard or mandatory hosted service', <MessagesSquare />],
  ['Multi-agent foundation', 'Typed IPC contracts and bounded request lifecycle for future agent orchestration', <Network />],
  ['Security controls', 'Context isolation, sandbox, CSP, secureStorage API keys, path boundaries and network policy', <ShieldCheck />],
] as const;

export function ToolsView({ onStartAssistant }: { onStartAssistant: () => void }) {
  return <section className="side-view tools-view">
    <div className="side-heading">NATIVE IDE CAPABILITIES</div>
    <p className="tools-intro">BibzCode IDE is an Electron-native workbench. AI runs inside the IDE through the configured provider and API key; Python and the BibzCode CLI are optional developer tools, never startup requirements.</p>
    <button className="primary-button" onClick={onStartAssistant}><Bot /> Open native AI assistant</button>
    <div className="feature-list">{groups.map(([title, description, icon]) => <article key={title}>{icon}<div><strong>{title}</strong><span>{description}</span></div></article>)}</div>
  </section>;
}
