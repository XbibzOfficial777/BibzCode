import { Bot, Boxes, Braces, Cable, Database, FileArchive, Globe2, MessagesSquare, Network, ShieldCheck, Wrench } from 'lucide-react';

const groups = [
  ['8 LLM providers', 'OpenRouter, Gemini, OpenAI, Anthropic, Groq, Together, Hugging Face, Agnes', <Bot />],
  ['115 built-in tools', '86 core tools and 29 optional browser, Selenium, document and skill tools', <Wrench />],
  ['MCP servers', 'Discover and run tools from approved external Model Context Protocol servers', <Cable />],
  ['Workspace intelligence', 'Read, search, edit, diff and reason over the currently opened project', <Braces />],
  ['Documents & media', 'PDF, DOCX, PPTX, XLSX, CSV, OCR, image, audio, video and APK utilities', <FileArchive />],
  ['Browser automation', 'Controlled HTTP and optional Selenium workflows with network policy enforcement', <Globe2 />],
  ['Sessions & memory', 'Persistent sessions, lossless archives, automatic compaction and export', <Database />],
  ['Remote connectors', 'Identity-isolated Telegram and Discord connectors with strict host restrictions', <MessagesSquare />],
  ['Multi-agent planning', 'Bounded planning, sub-agents and approval-preserving delegation', <Network />],
  ['Security controls', 'Local approval, redaction, path boundaries, redirect checks and bounded processes', <ShieldCheck />],
  ['Three install modes', 'Managed venv, active venv, or user/default Python', <Boxes />],
] as const;

export function ToolsView({ onStartAssistant }: { onStartAssistant: () => void }) {
  return <section className="side-view tools-view">
    <div className="side-heading">FEATURE PARITY</div>
    <p className="tools-intro">The Assistant panel launches the bundled canonical <code>bibzcode</code> runtime. Every CLI slash command, provider, tool, session, approval prompt, MCP server and connector remains available.</p>
    <button className="primary-button" onClick={onStartAssistant}><Bot /> Start full BibzCode assistant</button>
    <div className="feature-list">{groups.map(([title, description, icon]) => <article key={title}>{icon}<div><strong>{title}</strong><span>{description}</span></div></article>)}</div>
  </section>;
}
