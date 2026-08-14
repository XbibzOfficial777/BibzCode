# Development Guide

See `AGENTS.md` for architecture, security invariants, and release checks.

Important modules:

- `bibzcode/agent.py`: planning, streaming loop, approval and execution flow
- `bibzcode/toolkit.py`: schemas, validation, source capabilities, SSRF/path policy
- `bibzcode/providers.py`: provider protocol adapters
- `bibzcode/auth.py`: Firebase authentication and token refresh
- `bibzcode/config.py`: local config and authenticated Worker client
- `bibzcode/connectors.py`: allowlisted Telegram/Discord polling
- `dashboard-react/worker.js`: admin/user API, Firebase Admin, D1 persistence
- `dashboard-react/migrations/`: D1 schema

Do not reintroduce GitHub Gist as a runtime dependency. GitHub remains an optional
source-code mirror only; Cloudflare hosts the verified release archive.
