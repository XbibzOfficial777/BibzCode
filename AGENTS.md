# DeepSeek CLI 7.8.0-r6 — Agent Notes

## Runtime flow

`__main__` → Firebase authentication → authenticated Cloudflare access check →
`repl` → `Agent` → provider stream → centralized ToolRegistry policy → handler.

## Non-negotiable security rules

1. All tool callers must use `ToolRegistry.validate_args`, `authorize`, or
   `prepare_execution`; never invoke a handler directly without that policy.
2. Remote connectors only receive `REMOTE_SAFE_TOOLS` and require explicit ID
   whitelists.
3. Sub-agents cannot execute tools requiring local approval.
4. Never expose all `os.environ` to child processes.
5. Never commit Firebase service-account JSON, Cloudflare tokens, passcodes, or
   provider API keys.
6. Keep all network requests finite and cancellable.
7. All session IDs must pass `_session_path` validation.
8. Cloudflare Worker client endpoints use Firebase Bearer tokens; admin endpoints
   use the signed HttpOnly session cookie.
9. Usage/version persistence is Cloudflare D1, not GitHub Gist.
10. Deploy Firebase RTDB deny-by-default rules from
    `firebase-database.rules.json` using a newly rotated credential.
11. Auto-compaction must archive original messages losslessly before removing
    them from active context. Never replace history with only a summary.

## Validation before release

```bash
python -m compileall -q deepseek
python -m pyflakes deepseek tests
pytest -q
bash -n install.sh
cd dashboard-react
npm ci
npm run lint
npm run build
npm audit --omit=dev
node --check worker.js
npx wrangler deploy --dry-run
```

## Built-in tool counts

- Core dependency installation: 86
- Optional Selenium/browser/skill additions: 29
- Maximum built-in: 115, plus dynamic MCP tools

## Release mirror

- Installer: `https://deepseek-dash.bibzflow.workers.dev/install.sh`
- Archive: `/releases/deepseek-cli-7.8.0-r6.tar.gz`
- Integrity: adjacent `.sha256.txt` file
