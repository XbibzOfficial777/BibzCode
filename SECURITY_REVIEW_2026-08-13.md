# Security Review: DeepSeek CLI 7.8.0-r6

**Review date:** 13 August 2026 (Asia/Jakarta)
**Baseline reviewed:** GitHub `main` commit `37bf70827a42396a21f22e58b8493231383b159d`
**Method:** Sentry `security-review` skill, whole-codebase data-flow research, focused manual review, exploit-path verification, static analysis, dependency audit, and runtime regression tests.

## Summary

- **Confirmed findings:** 3 (2 High, 1 Medium)
- **Confidence:** High for all reported findings
- **Current status:** All three confirmed findings remediated and regression-tested
- **Post-remediation risk:** Low for the reviewed findings

No remaining high-confidence vulnerability was identified after remediation.

## Findings

### VULN-001 — Client-controlled authentication and access-policy bypass (High)

- **Original locations:** `deepseek/auth.py:463-485`, `deepseek/config.py:603-605`, `deepseek/config.py:651-652` at baseline commit
- **Confidence:** High
- **Issue:** Production code honored `DEEPSEEK_SKIP_AUTH=1` and `DEEPSEEK_SKIP_ACCESS_GATE=1`. A local CLI user could set both environment variables and receive a synthetic `dev` session while skipping Worker ban and quota checks.
- **Impact:** Trivial bypass of the application's intended Firebase authentication, account ban, device ban, and token-limit enforcement.
- **Verified evidence:** Executing the baseline with both variables returned `uid=dev` and `_cached_usage_status={'offline': True}` without contacting Firebase or the Worker.
- **Remediation:** Removed both production bypasses. The access gate now fails closed. The Worker origin is pinned exactly; the legacy custom-backend override can no longer redirect Firebase ID tokens to another origin.
- **Regression coverage:** `test_production_auth_and_access_gate_ignore_skip_environment` and `test_backend_origin_is_pinned_even_with_legacy_override`.
- **Architectural note:** A user who controls a local Python installation can always patch client code. Server-owned resources must continue enforcing authorization server-side; this remediation removes the shipped, one-variable bypass and prevents accidental credential redirection.

### VULN-002 — Broken RTDB authentication undermined profile registration and account-ban coverage (High)

- **Original locations:** `deepseek/auth.py:138-182`, `deepseek/auth.py:313-327`, `deepseek/auth.py:390-415` at baseline commit
- **Confidence:** High
- **Issue:** The CLI sent a Firebase ID token to RTDB as `Authorization: Bearer`. RTDB treats that header as a Google OAuth credential; Firebase ID tokens must not be used there in this form. Every profile read/write failed with HTTP 401, and broad exception handlers converted those failures to empty profiles or `False`.
- **Impact:** New Firebase identities could be created but profile bootstrap failed before the verification flow completed. Missing RTDB profiles were omitted from the dashboard's account-management list, weakening account-level ban administration and leaving only per-device controls.
- **Verified evidence:** The same valid Firebase ID token received HTTP 401 from the direct RTDB Bearer request and HTTP 200 from the authenticated Worker user API.
- **Remediation:** Removed all direct CLI-to-RTDB profile operations. Added `/api/user/bootstrap`, which verifies the Firebase token, requires verified email, derives UID/email server-side, validates username/platform, scopes writes to the authenticated UID, and writes through the service-account channel. The CLI now synchronizes only through this fixed Worker origin with the token in an Authorization header.
- **Regression coverage:** `test_profile_sync_uses_worker_header_not_token_url`, live bootstrap/profile checks, and authenticated admin-user visibility check.

### VULN-003 — Response limit applied only after full body buffering (Medium)

- **Original location:** `deepseek/net_policy.py:111-126` at baseline commit
- **Confidence:** High
- **Issue:** `safe_httpx_request` called `client.send(..., stream=False)` for normal requests. httpx therefore buffered the complete response before `len(response.content)` checked `max_response_bytes`. An attacker-controlled public endpoint could omit `Content-Length` and stream an arbitrarily large decoded body.
- **Impact:** Memory exhaustion or process termination through `web_fetch`, OCR URL handling, or HTTP browser operations that advertised a response-size limit.
- **Remediation:** Requests with a byte limit are now forced into streaming mode. Decoded chunks are counted before append, the response is closed immediately on overflow, and a normal buffered response is constructed only after the entire body is proven within bounds.
- **Regression coverage:** `test_bounded_http_response_is_streamed_and_stopped_at_limit` confirms consumption stops at the second chunk and never reads the third chunk after the limit is crossed.

## Needs Verification

### VERIFY-001 — DNS resolution and connection are not cryptographically pinned

- **Location:** `deepseek/net_policy.py`
- **Question:** URL policy validates all DNS answers before the HTTP library performs its own resolution. A hostile authoritative DNS server may be able to change an answer between validation and connection (DNS rebinding/TOCTOU).
- **Current mitigations:** all resolved non-global addresses are rejected; redirects are manually revalidated; localhost, metadata, internal suffixes, credentials-in-URL, and nonstandard ports are blocked by default.
- **Reason not reported as a confirmed vulnerability:** exploitability depends on resolver caching, transport behavior, and timing and was not reproduced in this environment. A future hardening pass should evaluate IP pinning while preserving TLS SNI and certificate verification.

## Validation Results

- Python 3.13: 53 tests passed
- Python 3.10.18 clean environment: 53 tests passed
- compileall: passed on Python 3.10 and 3.13
- pyflakes: zero findings
- Bandit medium-or-higher: zero findings
- pip-audit with hashed runtime lock: zero known vulnerabilities
- deterministic release rebuild: passed on Python 3.10 and 3.13
- Python wheel and sdist: built successfully
- Dashboard ESLint and production build: passed
- npm production/full audits: zero vulnerabilities
- Secret-pattern scan: no committed GitHub token, Cloudflare token, private key, or supplied password
- Production `/api/user/bootstrap`: 401 without authentication; 200 with a verified Firebase ID token
- Production profile and admin-user listing: 200 after bootstrap

## Non-findings Confirmed During Research

- Shell/code execution tools require explicit local approval and use process-group timeout handling.
- Remote connector capabilities are deny-by-default and require a non-empty user-ID whitelist to start.
- Out-of-workspace and sensitive paths require approval; persistent approvals are workspace-scoped and unavailable for shell/delete/install/browser/MCP/delegation.
- Parser tools execute in a killable resource-limited child process.
- Archive installation validates SHA-256, traversal, links/devices, and uncompressed size before extraction.
- Dependencies are installed from hashed locks; current runtime audit has no known CVEs.
- Firebase web API keys in the client are project identifiers, not service-account secrets.
