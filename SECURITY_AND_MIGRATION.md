# DeepSeek CLI 7.8.0-r6 Security and Migration Notes

## Security changes in r6

- Runtime and API version now include the `-r6` security revision.
- CLI release is built deterministically from one source tree; Cloudflare and the
  GitHub nightly mirror serve the same archive whose SHA-256 is embedded in the
  installer.
- Installer uses safe archive extraction, hashed dependency locks, atomic app
  replacement, and non-destructive `--uninstall`; `--purge` requires confirmation.
- All tool schemas, including dynamically registered MCP tools, receive nested
  JSON-Schema validation.
- Persistent tool approvals are workspace-scoped and disabled for shell, delete,
  install, browser, MCP, delegation, sensitive paths, and out-of-workspace actions.
- Outbound HTTP redirects are revalidated against a shared private-network policy.
- Untrusted document/media parsers run in a resource-limited child process that is
  killed with its process group on timeout.
- PyPDF2 was replaced by patched `pypdf` 6.x.
- Connector classes and manager both deny startup without a user-ID whitelist;
  downloads have per-file, per-identity, count, and age limits.
- MCP filesystem preset is rooted at the active workspace and timed-out futures are
  cancelled.
- Local config/auth/session/log directories and files are permission-hardened.
- Common credentials are redacted from tool arguments, output, cookie views, and
  session persistence.
- Synthetic visible-reasoning pre-pass is disabled by default.

## Worker/control-plane changes

- Verified email is enforced server-side for CLI and user APIs.
- `/api/check` uses an indexed `(uid, ip)` query instead of scanning all D1 rows.
- Usage events require an idempotency ID and are UID/IP rate-limited.
- D1/per-device bans and limits are checked before increments.
- Admin login has D1-backed attempt limits; admin mutations are audited.
- JSON request bodies are limited to 64 KiB.
- Firebase user ID tokens are sent in the Authorization header, not query strings.
- Service-account OAuth scopes were reduced.
- Version registry accepts and publishes `7.8.0-r6`.
- Static assets run through Worker security headers (`run_worker_first = true`).
- CSV export neutralizes spreadsheet formulas.

## D1 migration

Apply before Worker deployment:

```bash
cd dashboard-react
npx wrangler d1 migrations apply deepseek-dash-db --remote
```

Migration `0002_security_r6.sql` adds rate limits, usage-event idempotency,
admin login attempts, audit records, and publishes `7.8.0-r6`.

## Required Firebase action

The repository rules are deny-by-default, but Firebase Rules are deployed outside
Cloudflare. The project owner must use a newly rotated Google credential to deploy
`firebase-database.rules.json`, then verify unauthenticated reads and writes fail.

The service-account key exposed in the historical artifact must be deleted in
Google Cloud IAM; replacing source files or Worker secrets does not revoke it.

## Credential rotation

Cloudflare API tokens, GitHub PATs, admin passcodes, and any credential shared in a
conversation must be revoked after deployment. Rotate `SESSION_SECRET` to invalidate
all old admin sessions.

## Quota trust boundary

Usage events are authenticated, bounded, idempotent, and rate-limited, but the CLI
and provider API key are controlled by the local user. Therefore local telemetry is
advisory. Cryptographic billing enforcement requires proxying and metering provider
traffic server-side.
