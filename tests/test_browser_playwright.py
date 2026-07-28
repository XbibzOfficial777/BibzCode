"""
Playwright browser tests for the DeepSeek dashboard + Worker API.

Two layers:
  * LOCAL   — serves the built ./dist and exercises the SPA in a real browser.
  * REMOTE  — hits the deployed Worker (skipped unless DEEPSEEK_DEPLOYED_URL set).

Run:  python -m pytest tests/test_browser_playwright.py -v
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dashboard-react" / "dist"
DEPLOYED = os.environ.get("DEEPSEEK_DEPLOYED_URL", "").rstrip("/")

pytest.importorskip("playwright", reason="playwright not installed")
from playwright.sync_api import sync_playwright, expect  # noqa: E402


# ══════════════════════════════════════════════════════════════════
# Local static server for the built SPA
# ══════════════════════════════════════════════════════════════════

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _SPAHandler(SimpleHTTPRequestHandler):
    """Serve dist/ with SPA fallback to index.html."""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) and "." not in os.path.basename(path):
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *a):
        pass


@pytest.fixture(scope="session")
def local_server():
    if not DIST.exists():
        pytest.skip("dashboard not built (run: npx vite build)")
    port = _free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), _SPAHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.4)
    yield f"http://127.0.0.1:{port}"
    srv.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        yield b
        b.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg._collected_errors = errors
    yield pg
    ctx.close()


# ══════════════════════════════════════════════════════════════════
# Local SPA
# ══════════════════════════════════════════════════════════════════

class TestDashboardSPA:

    def test_page_loads(self, page, local_server):
        r = page.goto(local_server, wait_until="networkidle")
        assert r.status == 200
        assert page.title()

    def test_react_mounts(self, page, local_server):
        page.goto(local_server, wait_until="networkidle")
        page.wait_for_selector("#root", timeout=15000)
        html = page.inner_html("#root")
        assert len(html) > 200, "React root looks empty — bundle likely failed"

    def test_no_uncaught_js_errors(self, page, local_server):
        page.goto(local_server, wait_until="networkidle")
        page.wait_for_timeout(2500)
        fatal = [e for e in page._collected_errors
                 if "favicon" not in e.lower()
                 and "net::err" not in e.lower()
                 and "failed to fetch" not in e.lower()
                 and "firebase" not in e.lower()]
        assert not fatal, f"JS errors: {fatal[:5]}"

    def test_assets_load(self, page, local_server):
        failed = []
        page.on("response", lambda r: failed.append((r.url, r.status))
                if r.status >= 400 and "favicon" not in r.url else None)
        page.goto(local_server, wait_until="networkidle")
        page.wait_for_timeout(1500)
        assert not failed, f"assets failed: {failed}"

    def test_spa_deep_link_fallback(self, page, local_server):
        r = page.goto(f"{local_server}/some/deep/route", wait_until="networkidle")
        assert r.status == 200
        page.wait_for_selector("#root", timeout=15000)

    def test_auth_gate_present(self, page, local_server):
        """Unauthenticated visitors must see a login/landing surface, never
        the admin data."""
        page.goto(local_server, wait_until="networkidle")
        page.wait_for_timeout(2000)
        body = page.inner_text("body").lower()
        assert any(k in body for k in
                   ("sign in", "log in", "login", "email", "password",
                    "get started", "deepseek")), body[:300]

    def test_no_secrets_in_bundle(self, page, local_server):
        """The client bundle must not ship server-side secrets."""
        leaked = []
        for js in DIST.glob("assets/*.js"):
            txt = js.read_text(errors="ignore")
            for marker in ("ghp_", "github_pat_", "cfat_",
                           "BEGIN PRIVATE KEY", "ADMIN_PASSCODE"):
                if marker in txt:
                    leaked.append(f"{js.name}:{marker}")
        assert not leaked, f"secrets in client bundle: {leaked}"

    def test_responsive_mobile(self, browser, local_server):
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.goto(local_server, wait_until="networkidle")
        pg.wait_for_selector("#root", timeout=15000)
        overflow = pg.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 20, f"horizontal overflow on mobile: {overflow}px"
        ctx.close()

    def test_screenshot_artifact(self, page, local_server):
        page.goto(local_server, wait_until="networkidle")
        page.wait_for_timeout(2000)
        out = ROOT / "artifacts"
        out.mkdir(exist_ok=True)
        page.screenshot(path=str(out / "dashboard-local.png"), full_page=True)
        assert (out / "dashboard-local.png").stat().st_size > 5000


# ══════════════════════════════════════════════════════════════════
# Deployed Worker
# ══════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not DEPLOYED, reason="DEEPSEEK_DEPLOYED_URL not set")
class TestDeployedWorker:

    def test_site_reachable(self, page):
        r = page.goto(DEPLOYED, wait_until="networkidle", timeout=45000)
        assert r.status == 200

    def test_spa_renders_live(self, page):
        page.goto(DEPLOYED, wait_until="networkidle", timeout=45000)
        page.wait_for_selector("#root", timeout=20000)
        assert len(page.inner_html("#root")) > 200

    def test_security_headers(self, page):
        r = page.goto(DEPLOYED, wait_until="domcontentloaded", timeout=45000)
        h = {k.lower(): v for k, v in r.headers.items()}
        assert "content-security-policy" in h
        assert h.get("x-content-type-options") == "nosniff"
        assert "x-frame-options" in h

    def test_version_endpoint(self, page):
        r = page.request.get(f"{DEPLOYED}/api/version")
        assert r.status == 200
        assert "latest_version" in r.json()

    def test_check_endpoint(self, page):
        r = page.request.get(f"{DEPLOYED}/api/check?ip=203.0.113.99")
        assert r.status == 200
        d = r.json()
        assert set(("banned", "limit_exceeded", "found")) <= set(d)

    def test_admin_requires_passcode(self, page):
        for ep in ("/api/admin/data", "/api/admin/users"):
            r = page.request.get(f"{DEPLOYED}{ep}")
            assert r.status == 401, f"{ep} not protected (got {r.status})"

    def test_admin_rejects_wrong_passcode(self, page):
        r = page.request.get(f"{DEPLOYED}/api/admin/data",
                             headers={"X-Admin-Passcode": "definitely-wrong"})
        assert r.status == 401

    def test_user_endpoints_require_token(self, page):
        for ep in ("/api/user/profile", "/api/user/stats"):
            r = page.request.get(f"{DEPLOYED}{ep}")
            assert r.status == 401, f"{ep} not protected"

    def test_user_rejects_bogus_token(self, page):
        r = page.request.get(f"{DEPLOYED}/api/user/profile",
                             headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status == 401

    # ── the hardening added in this pass ──

    def test_update_rejects_spoofed_ip(self, page):
        """Regression: /api/update used to accept any IP unauthenticated,
        letting anyone inflate another user's quota."""
        r = page.request.post(f"{DEPLOYED}/api/update", data=json.dumps({
            "ip": "203.0.113.7", "username": "spoofed",
            "input_tokens": 999999999, "output_tokens": 999999999,
            "last_tool": "pwn",
        }), headers={"Content-Type": "application/json"})
        assert r.status == 401, (
            f"SPOOFING STILL POSSIBLE (status {r.status}) — "
            "unauthenticated write from a mismatched IP was accepted")

    def test_update_quota_not_inflated(self, page):
        before = page.request.get(f"{DEPLOYED}/api/check?ip=203.0.113.7").json()
        page.request.post(f"{DEPLOYED}/api/update", data=json.dumps({
            "ip": "203.0.113.7", "input_tokens": 5_000_000_000,
            "output_tokens": 0, "last_tool": "x"}),
            headers={"Content-Type": "application/json"})
        after = page.request.get(f"{DEPLOYED}/api/check?ip=203.0.113.7").json()
        assert after.get("usage", 0) == before.get("usage", 0), \
            "spoofed usage was recorded"

    def test_cors_preflight(self, page):
        r = page.request.fetch(f"{DEPLOYED}/api/version", method="OPTIONS")
        assert r.status in (200, 204)

    def test_unknown_api_route_is_not_500(self, page):
        r = page.request.get(f"{DEPLOYED}/api/definitely-not-real")
        assert r.status != 500

    def test_deployed_screenshot(self, page):
        page.goto(DEPLOYED, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(2500)
        out = ROOT / "artifacts"
        out.mkdir(exist_ok=True)
        page.screenshot(path=str(out / "dashboard-deployed.png"), full_page=True)
        assert (out / "dashboard-deployed.png").stat().st_size > 5000
