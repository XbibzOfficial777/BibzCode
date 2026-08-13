# DeepSeek CLI 7.8.0-r6 — Remediation and Deployment Report

**Completed:** 13 August 2026 (Asia/Jakarta)  
**GitHub branch:** `nightly`  
**Final CLI commit at verification:** `453e92e53a697dd22fa1f0dfa04fa1b33fa6424b`  
**Cloudflare Worker:** `https://deepseek-dash.bibzflow.workers.dev`  
**Final Worker deployment ID:** `8cff904f-be0c-446c-908d-4b44a549f1f7` before the installer-only asset refresh; final live behavior and hashes were reverified after refresh.

## Published artifacts

- Runtime version: `7.8.0-r6`
- Python package version: `7.8.0.post6`
- Installer SHA-256: `1836b667ca7195bb2174cae151882550d0a4ffd3bb1a1c6afb0b6edf13220e3e`
- Release SHA-256: `bb81aaa1944c8f616ed5d7f3581faaca0bce3d85988db85336476502ca002e55`
- Release URL: `/releases/deepseek-cli-7.8.0-r6.tar.gz`
- Versioned installer: `/installers/install-7.8.0-r6.sh`

The Cloudflare and GitHub nightly archives were verified byte-for-byte identical.
Dashboard React/Worker source changes were deliberately not included in GitHub
commits; only the CLI source, tests, release, installer, and CLI documentation were
pushed to `nightly` as requested.

## Critical remediation completed

- Firebase RTDB deny-by-default rules deployed and verified: unauthenticated root
  and `dscliUsers` reads now return HTTP 401 `Permission denied`.
- D1 migrations `0001_init.sql` and `0002_security_r6.sql` applied remotely.
- `/api/version` repaired and now returns `7.8.0-r6`.
- Admin `SESSION_SECRET` rotated, invalidating old cookies.
- Admin passcode rotated to a generated high-entropy value. The one-time value is
  stored outside the repository in `ADMIN_PASSCODE_R6.txt` with mode `0600`.
- Old public r6 archive/installer replaced by deterministic CLI-only artifacts.
- Destructive legacy uninstaller replaced by separate safe `--uninstall` and
  confirmed `--purge` behavior.

## Security implementation

- Server-side verified-email enforcement.
- D1 rate limiting, admin login lockout, usage idempotency, and admin audit log.
- Direct indexed `/api/check` query; per-device ban/limit checked before update.
- 64 KiB JSON body limit and same-origin CORS enforcement.
- RTDB bearer credentials removed from query strings.
- Resource-limited, killable parser child process.
- Process-group termination for code/shell timeouts.
- Patched `pypdf` 6.x replaces vulnerable PyPDF2.
- Shared redirect-aware private-network policy.
- Workspace-scoped persistent approvals; sensitive actions are approval-once only.
- Nested schema validation for built-in and dynamically registered MCP tools.
- Connector defense-in-depth whitelist and upload retention/quota controls.
- MCP filesystem rooted at workspace and timed-out futures cancelled.
- Secret redaction for arguments, output, cookie views, logs, and sessions.
- Private local file/directory permissions.
- Synthetic reasoning pre-pass disabled by default.
- Hashed universal Python dependency locks.
- Spreadsheet formula neutralization in admin CSV export.
- Wrangler upgraded to 4.122.0; npm production and full audits both report zero.

## Verification results

- Python 3.13: 49 tests passed.
- Python 3.10 clean venv: 49 tests passed.
- Compileall: pass on Python 3.10 and 3.13.
- Pyflakes: zero findings.
- Bandit: zero medium/high findings.
- pip-audit locked runtime: zero known vulnerabilities.
- Python wheel and sdist build: pass.
- Deterministic release rebuild: pass.
- Archive traversal/link/device validation: pass.
- Installer local smoke: pass.
- Cloudflare remote installer smoke on Python 3.13: pass.
- Cloudflare remote installer smoke on Python 3.10: pass.
- React TypeScript build and ESLint: pass.
- npm production audit: zero.
- npm full audit: zero.
- Wrangler dry-run: pass on Node.js 22.
- GitHub `CLI security checks`: success on Python 3.10 and 3.13.
- Live unauthenticated CLI/admin endpoints: 401.
- Live malicious Origin test: 403.
- Live `/api/version`: 200 with `7.8.0-r6`.
- Live admin login/data/version/users: 200 with rotated credentials.
- Live RTDB unauthenticated reads: 401 permission denied.

The separate GitHub “Code scanning AI findings” automation failed because its
configured Copilot model was not supported (HTTP 400); this is an external workflow
configuration error, not a source scan finding. The repository's deterministic CLI
security workflow passed.

## External credential actions still required

The current Firebase service-account secret remains operational so the Worker can
perform admin operations. A historically exposed service-account key cannot be
revoked from this codebase. A Google Cloud project owner must delete the exposed key,
create a new least-privilege credential (prefer Workload Identity), replace the
Worker secret, and review Cloud Audit Logs.

The GitHub PAT and Cloudflare API token supplied for this deployment were exposed in
conversation history. Revoke both immediately after confirming this deployment.
These token lifecycle operations require the account-owner security consoles and
are intentionally not embedded in source or deployment scripts.
