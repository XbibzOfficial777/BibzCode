# Development Guide

See `AGENTS.md` for security invariants and release checks.

Important modules:

- `bibzcode/agent.py`: planning, streaming loop, approval and execution flow
- `bibzcode/toolkit.py`: schemas, validation, source capabilities, SSRF/path policy
- `bibzcode/providers.py`: provider protocol adapters
- `bibzcode/auth.py`: Firebase authentication and token refresh
- `bibzcode/config.py`: local config and authenticated Worker client
- `bibzcode/connectors.py`: allowlisted Telegram/Discord polling

Do not reintroduce GitHub Gist as a runtime dependency. GitHub remains an optional
source-code mirror only; Cloudflare hosts the verified release archive.
