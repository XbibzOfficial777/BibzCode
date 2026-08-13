# DeepSeek CLI Agent 7.8.0-r6

Multi-provider terminal AI agent with controlled tool execution, session persistence,
MCP support, document utilities, browser automation, and optional Telegram/Discord
connectors.

## Requirements

- Python **3.10+**
- Linux, macOS, or Termux
- A Firebase account for CLI access
- An API key for at least one supported LLM provider

## Install

The Cloudflare mirror works when GitHub is unavailable or blocked:

```bash
curl -fsSL https://deepseek-dash.bibzflow.workers.dev/install.sh | bash
```

Install optional browser/document/OCR dependencies:

```bash
curl -fsSL https://deepseek-dash.bibzflow.workers.dev/install.sh | bash -s -- --full
```

Local checkout:

```bash
bash install.sh
```

The installer contains the expected SHA-256 of one immutable r6 tarball. Cloudflare
and the nightly GitHub mirror serve that same byte-for-byte archive; mutable per-file
downloads are not used. Source order can be changed with
`DEEPSEEK_SOURCE_ORDER=github,cf`.

## Uninstall

```bash
bash install.sh --uninstall        # keeps config/auth/sessions/uploads/venv
bash install.sh --purge            # interactive destructive confirmation
bash install.sh --purge --yes      # non-interactive destructive purge
```

## Start

```bash
dscli
```

Useful commands:

```text
/provider       switch provider
/model          switch model
/key            configure provider API key
/tools          list tools available in this installation
/mcp            manage external MCP servers
/telegram       configure the Telegram connector
/discord        configure the Discord connector
/session        list sessions
/export         export conversation
/exit           save and exit
```

## Providers

- OpenRouter
- Google Gemini
- OpenAI
- Anthropic
- Groq
- Together AI
- Hugging Face
- Agnes AI

## Tool count

- 86 built-in tools with core dependencies
- 29 additional Selenium/browser/skill tools when the optional stack is installed
- 115 maximum built-in tools, plus tools discovered dynamically from MCP servers

The agent sends a source-specific capability set. Remote Telegram/Discord sessions
cannot access host filesystem, shell, environment variables, browser credentials,
external MCP processes, or sub-agent delegation.

## Security model

- Main-agent tool arguments are validated before execution.
- Mutating, sensitive, browser, external-MCP, and out-of-workspace operations
  require local approval.
- Sub-agents cannot bypass local approval.
- Telegram/Discord refuse to start without an explicit user-ID whitelist.
- Each connector identity has isolated conversation memory.
- Private/local network destinations are blocked by default. Set
  `DEEPSEEK_ALLOW_PRIVATE_NETWORK=1` only in a trusted development environment.
- Environment, tool-argument, cookie, and common tool-result secrets are redacted.
- Provider HTTP requests have finite timeouts and retries have a bounded deadline.
- Untrusted PDF/Office/image/media parsers run in a resource-limited child process
  that is killed as a process group on timeout.
- Persistent approvals are scoped to workspace-writing tools; shell, delete,
  install, browser, MCP, delegation, sensitive-path, and out-of-workspace actions
  can only be approved once.
- Every HTTP redirect is revalidated by the HTTP browser/fetch/download policy.

## Connector replies and file handling

Telegram and Discord connectors preserve structured context for the current message
and the message being replied to. Supported attachment metadata/content paths include:

- text and generic documents;
- PDF, DOCX, PPTX, XLSX, and CSV;
- images and OCR-capable images;
- audio/video files for available metadata tools;
- APK files;
- Telegram photos, documents, audio, voice, video, animation, video notes, stickers;
- Discord attachments, embeds, stickers, polls, mentions, and referenced messages;
- Telegram contact, location, venue, poll, quote, and forwarded-message metadata.

Files from both the current and replied message are downloaded with a configurable
size limit (25 MB by default), sanitized filenames, private permissions, and no bot
token in model-visible context. Remote agents receive read-only access to the exact
downloaded paths—never arbitrary host filesystem access.

```bash
export DEEPSEEK_CONNECTOR_MAX_FILE_MB=25
export DEEPSEEK_CONNECTOR_MAX_IDENTITY_MB=250
export DEEPSEEK_CONNECTOR_MAX_IDENTITY_FILES=100
export DEEPSEEK_CONNECTOR_FILE_TTL_HOURS=168
```

Each `(platform, chat, user)` has isolated conversation memory. Connector whitelists
remain mandatory.

## Automatic long-conversation memory

DeepSeek CLI automatically compacts active context before it reaches the model's
context limit (default trigger: 72%, or 80 active messages). Older turns are
summarized into structured long-term memory while their complete original messages
are moved to a lossless session archive. The archive is not sent on every model
request, but remains available after resume and is included in chat exports.

Useful commands:

```text
/compact   force a compaction now
/context   show active tokens, archived messages, summary and context limit
/info      show compaction status
```

Optional `config.yaml` settings:

```yaml
auto_compact: true
auto_compact_ratio: 0.72
auto_compact_message_count: 80
compact_keep_recent: 20
# context_window_tokens: 128000  # optional explicit model override
reasoning_prepass: false          # native reasoning stays available; synthetic extra call is opt-in
max_tool_rounds: 12               # bounded to 1..50
tool_timeout: 120                 # bounded to 5..600 seconds
```

If the summarization model fails, a deterministic fallback summary is created so
the request can continue without dropping the archived transcript. `/clear` is the
only command that intentionally removes both active and archived conversation.

## Usage accounting

The Worker accepts authenticated, bounded, idempotent usage events and enforces
per-UID/IP rate limits. Because the provider runs locally with a user-controlled API
key, this telemetry is advisory rather than cryptographic billing enforcement. True
billing enforcement requires provider traffic to be proxied and metered server-side.

## Local data

Stored under `~/.deepseek-cli/`:

- `config.yaml` — provider settings and local API keys (`0600`)
- `auth.json` — Firebase refresh/session tokens (`0600`)
- `sessions/` — conversation history (`0700` directory, `0600` files)
- `logs/` — local agent metrics (`0700` directory, `0600` files)
- `venv/` — installer-managed virtual environment

Session files may contain conversation and tool-result data. Do not share the
folder and do not place secrets in prompts.

## External MCP

MCP servers execute as child processes and can be powerful. Presets use pinned npm
versions and receive a minimal environment containing only the credential requested
by that server. The filesystem preset is rooted at the active workspace, not the
entire home directory. Review every server before connecting it.

## Dashboard deployment

```bash
cd dashboard-react
npm ci
npm run lint
npm run build
npx wrangler d1 migrations apply deepseek-dash-db --remote
npx wrangler secret put ADMIN_PASSCODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
npx wrangler deploy
```

Wrangler 4.122 requires Node.js 22+. `FIREBASE_SERVICE_ACCOUNT` must be a newly
rotated, least-privilege key. Never commit or package it. Deploy
`firebase-database.rules.json` separately through Firebase CLI/Console and verify
that unauthenticated reads and writes are denied.

## Development

```bash
python -m pip install -e '.[test,full]'
pytest
cd dashboard-react
npm ci
npm run lint
npm run build
```

## Architecture

```text
__main__.py -> Firebase auth -> Worker access check -> repl.py
repl.py -> Memory + ToolRegistry + Provider + Agent
Agent -> planner -> optional reasoning pass -> streaming provider loop
Agent -> centralized tool policy -> tool handler -> result -> provider
Worker -> signed admin cookie / verified Firebase bearer auth -> D1 + Firebase RTDB
```

## License

MIT — see `LICENSE`.
