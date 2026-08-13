# Development Guide

See `AGENTS.md` for architecture, security invariants, and release checks.

Important modules:

- `deepseek/agent.py`: planning, streaming loop, approval and execution flow
- `deepseek/toolkit.py`: schemas, validation, source capabilities, SSRF/path policy
- `deepseek/providers.py`: provider protocol adapters
- `deepseek/auth.py`: Firebase authentication and token refresh
- `deepseek/config.py`: local config and authenticated Worker client
- `deepseek/connectors.py`: allowlisted Telegram/Discord polling
- `dashboard-react/worker.js`: admin/user API, Firebase Admin, D1 persistence
- `dashboard-react/migrations/`: D1 schema

Do not reintroduce GitHub Gist as a runtime dependency. GitHub remains an optional
source-code mirror only; Cloudflare hosts the verified release archive.
