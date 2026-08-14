# BibzCode CLI v7.8.0 — Firebase Authentication Gate
# Email/password login + register (with username) + email verification +
# forgot-password (email reset). Verified profiles are synchronized through the
# Worker so the dashboard can manage them. Pure stdlib (urllib) — Termux friendly.

import getpass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .ui import console

# ── Firebase project configuration (web app config) ─────────────────────────
FIREBASE_API_KEY = os.environ.get(
    "BIBZCODE_FIREBASE_API_KEY", "AIzaSyDfdWsO1H11PjSY7IecaX_QICc14yLOtpQ"
)
IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1/accounts"
SECURETOKEN_BASE = "https://securetoken.googleapis.com/v1/token"
WORKER_API_BASE = "https://bibzcode.bibzflow.workers.dev"

AUTH_DIR = Path.home() / ".bibzcode-cli"
AUTH_FILE = AUTH_DIR / "auth.json"


# ════════════════════════════════════════════════════════════════════════════
# Low-level HTTP helpers
# ════════════════════════════════════════════════════════════════════════════

def _post_json(url: str, payload: dict, timeout: int = 15) -> dict:
    """POST JSON and return parsed dict. Raises FirebaseError on API errors."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "User-Agent": "bibzcode-cli-auth/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec B310
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = {}
        try:
            body = json.loads(e.read().decode())
        except Exception:
            pass
        msg = body.get("error", {}).get("message", f"HTTP {e.code}")
        raise FirebaseError(msg)
    except Exception as e:
        raise FirebaseError(str(e))


class FirebaseError(Exception):
    """Raised when a Firebase REST call returns an error."""


def _friendly_error(msg: str) -> str:
    """Map raw Firebase error codes to human messages."""
    table = {
        "EMAIL_EXISTS": "That email is already registered. Try logging in.",
        "EMAIL_NOT_FOUND": "No account found with that email.",
        "INVALID_PASSWORD": "Incorrect password.",
        "INVALID_LOGIN_CREDENTIALS": "Invalid email or password.",
        "INVALID_EMAIL": "That email address is not valid.",
        "USER_DISABLED": "This account has been disabled by the administrator.",
        "WEAK_PASSWORD : Password should be at least 6 characters": "Password must be at least 6 characters.",
        "MISSING_PASSWORD": "Password is required.",
        "TOO_MANY_ATTEMPTS_TRY_LATER": "Too many attempts. Please try again later.",
        "OPERATION_NOT_ALLOWED": "Email/password sign-in is disabled for this project.",
    }
    for key, val in table.items():
        if msg.startswith(key):
            return val
    return msg


# ════════════════════════════════════════════════════════════════════════════
# Firebase Identity Toolkit wrappers
# ════════════════════════════════════════════════════════════════════════════

def fb_sign_up(email: str, password: str) -> dict:
    return _post_json(f"{IDENTITY_BASE}:signUp?key={FIREBASE_API_KEY}",
                      {"email": email, "password": password, "returnSecureToken": True})


def fb_sign_in(email: str, password: str) -> dict:
    return _post_json(f"{IDENTITY_BASE}:signInWithPassword?key={FIREBASE_API_KEY}",
                      {"email": email, "password": password, "returnSecureToken": True})


def fb_send_verification(id_token: str) -> dict:
    return _post_json(f"{IDENTITY_BASE}:sendOobCode?key={FIREBASE_API_KEY}",
                      {"requestType": "VERIFY_EMAIL", "idToken": id_token})


def fb_send_password_reset(email: str) -> dict:
    return _post_json(f"{IDENTITY_BASE}:sendOobCode?key={FIREBASE_API_KEY}",
                      {"requestType": "PASSWORD_RESET", "email": email})


def fb_lookup(id_token: str) -> dict:
    """Return the first user record (incl. emailVerified) for an idToken."""
    res = _post_json(f"{IDENTITY_BASE}:lookup?key={FIREBASE_API_KEY}", {"idToken": id_token})
    users = res.get("users", [])
    return users[0] if users else {}


def fb_refresh(refresh_token: str) -> dict:
    """Exchange a refresh token for a fresh idToken."""
    data = f"grant_type=refresh_token&refresh_token={refresh_token}".encode()
    req = urllib.request.Request(
        f"{SECURETOKEN_BASE}?key={FIREBASE_API_KEY}", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:  # nosec B310
            return json.loads(resp.read().decode())
    except Exception:
        return {}


# ════════════════════════════════════════════════════════════════════════════
# Verified profile synchronization through the Worker
# ════════════════════════════════════════════════════════════════════════════
def _worker_user_json(path: str, id_token: str, payload: dict | None = None) -> dict:
    """Call an allowlisted user endpoint without placing credentials in URLs."""
    if path not in {"/api/user/bootstrap"}:
        raise ValueError("Unsupported user profile endpoint")
    if not id_token:
        raise FirebaseError("Missing Firebase ID token")
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{WORKER_API_BASE}{path}", data=data,
        headers={
            "Authorization": f"Bearer {id_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "bibzcode-cli-auth/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:  # nosec B310
            raw = resp.read(65_537)
            if len(raw) > 65_536:
                raise FirebaseError("Profile service response exceeded 64 KiB")
            result = json.loads(raw.decode("utf-8"))
            if not isinstance(result, dict):
                raise FirebaseError("Invalid profile service response")
            return result
    except urllib.error.HTTPError as exc:
        message = f"HTTP {exc.code}"
        try:
            body = json.loads(exc.read(4096).decode("utf-8", errors="replace"))
            message = str(body.get("error") or message)[:200]
        except Exception:
            pass
        raise FirebaseError(f"Profile synchronization failed: {message}") from exc
    except FirebaseError:
        raise
    except Exception as exc:
        raise FirebaseError(f"Profile synchronization failed: {exc}") from exc


def _sync_user_profile(session: dict, username: str = "") -> dict:
    """Create/update the authenticated user's server-owned profile safely."""
    profile = _worker_user_json(
        "/api/user/bootstrap", session.get("id_token", ""),
        {"username": str(username or "")[:32], "platform": sys.platform[:100]},
    )
    if profile.get("banned"):
        console.print()
        console.print("  [bold red]██ ACCESS DENIED ██[/bold red]")
        console.print("  [red]Your account has been banned by the administrator.[/red]")
        console.print()
        raise SystemExit(1)
    session["username"] = str(profile.get("username") or username or "")[:32]
    return profile


# ════════════════════════════════════════════════════════════════════════════
# Local session persistence
# ════════════════════════════════════════════════════════════════════════════

def _save_session(session: dict):
    try:
        AUTH_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(AUTH_DIR, 0o700)
        except OSError:
            pass
        with open(AUTH_FILE, "w") as f:
            json.dump(session, f)
        os.chmod(AUTH_FILE, 0o600)
    except Exception:
        pass


def _load_session() -> dict:
    try:
        if AUTH_FILE.exists():
            with open(AUTH_FILE) as f:
                return json.load(f) or {}
    except Exception:
        pass
    return {}


def logout():
    """Clear the locally stored session."""
    try:
        if AUTH_FILE.exists():
            AUTH_FILE.unlink()
    except Exception:
        pass


def _build_session(auth_resp: dict, username: str = "") -> dict:
    expires_in = int(auth_resp.get("expiresIn", "3600"))
    result = {
        "uid": auth_resp.get("localId") or auth_resp.get("user_id", ""),
        "username": username,
        "id_token": auth_resp.get("idToken") or auth_resp.get("id_token", ""),
        "refresh_token": auth_resp.get("refreshToken") or auth_resp.get("refresh_token", ""),
        "expires_at": time.time() + expires_in - 60,  # refresh a minute early
    }
    # Secure Token refresh responses do not contain email. Omitting the key
    # preserves the verified email already stored in the local session.
    if auth_resp.get("email"):
        result["email"] = auth_resp["email"]
    return result


# ════════════════════════════════════════════════════════════════════════════
# Interactive prompts (rich)
# ════════════════════════════════════════════════════════════════════════════

def _prompt(label: str) -> str:
    try:
        console.print(f"  [cyan]{label}[/cyan] ", end="")
        return input().strip()
    except (EOFError, KeyboardInterrupt):
        console.print()
        return ""


def _prompt_password(label: str) -> str:
    try:
        return getpass.getpass(f"  {label} ").strip()
    except (EOFError, KeyboardInterrupt):
        console.print()
        return ""


def _banner_auth():
    console.print()
    console.print("  [bold cyan]🔐 BibzCode CLI — Account Required[/bold cyan]")
    console.print("  [dim]Sign in or create an account to continue.[/dim]")
    console.print()


# ════════════════════════════════════════════════════════════════════════════
# Flows
# ════════════════════════════════════════════════════════════════════════════

def _do_register() -> dict:
    """Register an account and create its profile after email verification."""
    console.print("  [bold]Create a new account[/bold]")
    username = _prompt("Username    :")
    while not re.fullmatch(r'[a-zA-Z0-9_@.\-]{2,32}', username or ''):
        console.print("  [red]Username must be 2-32 characters: letters, digits, _, @, ., -[/red]")
        username = _prompt("Username    :")
    email = _prompt("Email       :")
    password = _prompt_password("Password    :")
    confirm = _prompt_password("Confirm pass:")
    if password != confirm:
        console.print("  [red]Passwords do not match.[/red]")
        return {}
    if len(password) < 6:
        console.print("  [red]Password must be at least 6 characters.[/red]")
        return {}

    try:
        resp = fb_sign_up(email, password)
    except FirebaseError as e:
        console.print(f"  [red]Registration failed: {_friendly_error(str(e))}[/red]")
        return {}

    session = _build_session(resp, username)

    # The profile is synchronized through the Worker only after verification,
    # so an unverified identity cannot write RTDB data directly.
    # Send verification email
    try:
        fb_send_verification(session["id_token"])
        console.print(f"\n  [green]✓ Account created![/green] A verification email was sent to [bold]{email}[/bold].")
    except FirebaseError as e:
        console.print(f"  [yellow]Account created but verification email failed: {_friendly_error(str(e))}[/yellow]")

    # Block until the email is verified
    return _await_verification(session, username)


def _await_verification(session: dict, username: str) -> dict:
    """Loop until the user's email is verified."""
    console.print("  [dim]Please verify your email, then return here.[/dim]")
    while True:
        console.print()
        console.print("  [cyan]Options:[/cyan] [bold]C[/bold]ontinue (I verified) · [bold]R[/bold]esend email · [bold]Q[/bold]uit")
        choice = _prompt("Choice      :").lower()
        if choice in ("q", "quit", "exit"):
            sys.exit(0)
        if choice in ("r", "resend"):
            # need a fresh token to resend
            refreshed = fb_refresh(session["refresh_token"])
            if refreshed:
                session.update(_build_session(refreshed, username))
            try:
                fb_send_verification(session["id_token"])
                console.print("  [green]✓ Verification email resent.[/green]")
            except FirebaseError as e:
                console.print(f"  [red]Resend failed: {_friendly_error(str(e))}[/red]")
            continue
        # default: continue / check
        refreshed = fb_refresh(session["refresh_token"])
        if refreshed:
            session.update(_build_session(refreshed, username))
        info = fb_lookup(session["id_token"])
        if info.get("emailVerified"):
            console.print("  [green]✓ Email verified![/green]")
            try:
                _sync_user_profile(session, username)
            except FirebaseError as exc:
                console.print(f"  [red]{_friendly_error(str(exc))}[/red]")
                return {}
            _save_session(session)
            return session
        console.print("  [yellow]Email not verified yet. Check your inbox (and spam), then choose Continue.[/yellow]")


def _do_login() -> dict:
    """Login with email + password. Requires verified email."""
    console.print("  [bold]Log in[/bold]")
    email = _prompt("Email       :")
    password = _prompt_password("Password    :")
    if not email or not password:
        console.print("  [red]Email and password are required.[/red]")
        return {}
    try:
        resp = fb_sign_in(email, password)
    except FirebaseError as e:
        console.print(f"  [red]Login failed: {_friendly_error(str(e))}[/red]")
        return {}

    session = _build_session(resp, "")

    # Enforce email verification before the Worker is allowed to create or
    # update the server-owned profile.
    info = fb_lookup(session["id_token"])
    if not info.get("emailVerified"):
        console.print("  [yellow]Your email is not verified yet.[/yellow]")
        return _await_verification(session, "")

    try:
        _sync_user_profile(session)
    except FirebaseError as exc:
        console.print(f"  [red]{_friendly_error(str(exc))}[/red]")
        return {}

    _save_session(session)
    console.print(f"  [green]✓ Welcome back, {session['username'] or email}![/green]")
    return session


def _do_forgot() -> None:
    """Send a password-reset email."""
    console.print("  [bold]Reset password[/bold]")
    email = _prompt("Email       :")
    if not email:
        return
    try:
        fb_send_password_reset(email)
        console.print(f"  [green]✓ Password reset email sent to {email}.[/green] Follow the link, then log in.")
    except FirebaseError as e:
        console.print(f"  [red]Could not send reset email: {_friendly_error(str(e))}[/red]")


# ════════════════════════════════════════════════════════════════════════════
# Public entrypoint
# ════════════════════════════════════════════════════════════════════════════

def _try_restore_session() -> dict:
    """Attempt to silently restore a saved, valid session."""
    sess = _load_session()
    if not sess or not sess.get("refresh_token"):
        return {}
    # Refresh the token (also validates the account still exists)
    refreshed = fb_refresh(sess["refresh_token"])
    if not refreshed:
        return {}
    sess.update(_build_session(refreshed, sess.get("username", "")))
    # Verify email + ban status are still good
    info = fb_lookup(sess["id_token"])
    if not info.get("emailVerified"):
        return {}
    try:
        _sync_user_profile(sess)
    except FirebaseError:
        return {}
    _save_session(sess)
    return sess


def get_valid_id_token() -> str:
    """Return a refreshed Firebase ID token for authenticated backend calls."""
    sess = _load_session()
    if not sess or not sess.get("refresh_token"):
        return ""
    if sess.get("id_token") and float(sess.get("expires_at", 0)) > time.time() + 120:
        return sess["id_token"]
    refreshed = fb_refresh(sess["refresh_token"])
    if not refreshed:
        return ""
    fresh = _build_session(refreshed, sess.get("username", ""))
    sess.update(fresh)
    _save_session(sess)
    return sess.get("id_token", "")


def ensure_authenticated() -> dict:
    """Gate the CLI behind Firebase auth. Returns the active session dict.

    Login persists across runs; the user is prompted only when no valid,
    verified server-backed session can be restored."""
    # 1) Silent restore
    sess = _try_restore_session()
    if sess:
        # Auth info is now integrated into show_welcome() in ui.py
        # (saved as a side-effect for the welcome banner to pick up).
        # We no longer print a separate "Signed in as" line — it was redundant
        # with the welcome message and cluttered recursive invocations.
        sys.modules[__name__]._current_session = sess
        return sess

    # 2) Interactive auth menu
    _banner_auth()
    while True:
        console.print("  [cyan]1[/cyan]) Log in    [cyan]2[/cyan]) Register    [cyan]3[/cyan]) Forgot password    [cyan]4[/cyan]) Exit")
        choice = _prompt("Select      :")
        if choice in ("1", "login", "l"):
            sess = _do_login()
            if sess:
                console.print()
                return sess
        elif choice in ("2", "register", "r", "signup"):
            sess = _do_register()
            if sess:
                console.print()
                return sess
        elif choice in ("3", "forgot", "reset", "f"):
            _do_forgot()
        elif choice in ("4", "exit", "quit", "q"):
            console.print("  [dim]Goodbye.[/dim]")
            sys.exit(0)
        else:
            console.print("  [yellow]Please choose 1–4.[/yellow]")
        console.print()
