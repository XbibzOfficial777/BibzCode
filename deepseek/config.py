# DeepSeek CLI v7.7 — Multi-Provider Configuration
# Manages 7 AI providers with YAML config file, API keys, and model selection
# NO TOOL LIMITS — all tools available at all times

import os
import sys
import platform
import socket
import yaml
from pathlib import Path

CONFIG_DIR = Path.home() / '.deepseek-cli'
CONFIG_FILE = CONFIG_DIR / 'config.yaml'
LEGACY_KEY_FILE = Path.home() / '.deepseek_api_key'
CLIENT_VERSION = "7.8"

# Default Gist ID — embedded so every install auto-connects to dashboard backend
# The Gist is public, no secret. PAT stays optional (env/config only, NOT in code).
_DEFAULT_GIST_ID = "55a91f3ee47f659d21a58a80826ca827"

# Public web dashboard. Account credentials (username / email / password) are
# managed exclusively there; the CLI is a read-only mirror of that identity.
DASHBOARD_URL = os.environ.get(
    "DEEPSEEK_DASHBOARD_URL", "https://deepseek-dash.bibzflow.workers.dev"
)

# ══════════════════════════════════════
# PROVIDER DEFINITIONS
# ══════════════════════════════════════

DEFAULT_PROVIDERS = {
    'openrouter': {
        'name': 'OpenRouter',
        'type': 'openai_compatible',
        'base_url': 'https://openrouter.ai/api/v1',
        'api_key_env': 'OPENROUTER_API_KEY',
        'default_model': 'deepseek/deepseek-r1-0528:free',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://openrouter.ai/keys',
        'extra_headers': {
            'HTTP-Referer': 'https://deepseek-cli.local',
            'X-Title': 'DeepSeek CLI v7.7',
        },
        'popular_models': [
            'deepseek/deepseek-r1-0528:free',
            'deepseek/deepseek-chat-v3-0324:free',
            'meta-llama/llama-4-maverick:free',
            'google/gemini-2.5-flash-preview:free',
            'qwen/qwen3-235b-a22b:free',
            'anthropic/claude-sonnet-4',
            'openai/gpt-4o',
            'openai/gpt-4.1-mini',
            'google/gemini-2.5-pro-preview-05-06',
        ],
    },
    'gemini': {
        'name': 'Google Gemini',
        'type': 'gemini',
        'base_url': 'https://generativelanguage.googleapis.com/v1beta',
        'api_key_env': 'GEMINI_API_KEY',
        'default_model': 'gemini-2.5-flash-preview-05-20',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://aistudio.google.com/apikey',
        'popular_models': [
            'gemini-2.5-flash-preview-05-20',
            'gemini-2.5-pro-preview-05-06',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
        ],
    },
    'huggingface': {
        'name': 'HuggingFace',
        'type': 'huggingface',
        'base_url': 'https://router.huggingface.co',
        'api_key_env': 'HUGGINGFACE_API_KEY',
        'default_model': 'Qwen/Qwen2.5-72B-Instruct',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://huggingface.co/settings/tokens',
        'popular_models': [
            'Qwen/Qwen2.5-72B-Instruct',
            'NousResearch/Hermes-3-Llama-3.1-8B',
            'meta-llama/Llama-3.3-70B-Instruct',
            'mistralai/Mistral-7B-Instruct-v0.3',
            'HuggingFaceH4/zephyr-7b-beta',
            'microsoft/Phi-3-mini-4k-instruct',
            'google/gemma-2-2b-it',
        ],
    },
    'openai': {
        'name': 'OpenAI',
        'type': 'openai_compatible',
        'base_url': 'https://api.openai.com/v1',
        'api_key_env': 'OPENAI_API_KEY',
        'default_model': 'gpt-4.1-mini',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': False,
        'get_key_url': 'https://platform.openai.com/api-keys',
        'popular_models': [
            'gpt-4.1-mini',
            'gpt-4.1',
            'gpt-4o',
            'gpt-4o-mini',
            'o3-mini',
            'o4-mini',
        ],
    },
    'anthropic': {
        'name': 'Anthropic (Claude)',
        'type': 'anthropic',
        'base_url': 'https://api.anthropic.com/v1',
        'api_key_env': 'ANTHROPIC_API_KEY',
        'default_model': 'claude-sonnet-4-20250514',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': False,
        'get_key_url': 'https://console.anthropic.com/settings/keys',
        'popular_models': [
            'claude-sonnet-4-20250514',
            'claude-haiku-4-20250414',
            'claude-3-5-haiku-20241022',
            'claude-3-5-sonnet-20241022',
        ],
    },
    'groq': {
        'name': 'Groq',
        'type': 'openai_compatible',
        'base_url': 'https://api.groq.com/openai/v1',
        'api_key_env': 'GROQ_API_KEY',
        'default_model': 'llama-3.3-70b-versatile',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://console.groq.com/keys',
        'popular_models': [
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
            'mixtral-8x7b-32768',
            'gemma2-9b-it',
            'qwen-qwq-32b',
        ],
    },
    'together': {
        'name': 'Together AI',
        'type': 'openai_compatible',
        'base_url': 'https://api.together.xyz/v1',
        'api_key_env': 'TOGETHER_API_KEY',
        'default_model': 'meta-llama/Llama-3-70b-chat-hf',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://api.together.xyz/settings/api-keys',
        'popular_models': [
            'meta-llama/Llama-3-70b-chat-hf',
            'mistralai/Mixtral-8x7B-Instruct-v0.1',
            'meta-llama/Llama-3-8b-chat-hf',
            'Qwen/Qwen2.5-72B-Instruct-Turbo',
        ],
    },
    'agnes': {
        'name': 'Agnes AI',
        'type': 'openai_compatible',
        'base_url': 'https://apihub.agnes-ai.com/v1',
        'api_key_env': 'AGNES_API_KEY',
        'default_model': 'agnes-2.0-flash',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://platform.agnes-ai.com',
        'popular_models': [
            'agnes-2.0-flash',
        ],
    },
}

# Agent settings
_stored_config = {}
try:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r') as _f:
            _stored_config = yaml.safe_load(_f) or {}
except Exception:
    pass

MAX_TOOL_ROUNDS = _stored_config.get('max_tool_rounds', 0)
MAX_TOKENS = _stored_config.get('max_tokens', 16384)
TEMPERATURE = _stored_config.get('temperature', 0.7)
TIMEOUT = None           # No HTTP timeout — AI determines response time
TOOL_TIMEOUT = 0         # 0 = no tool timeout, tools run until completion

# UI
BANNER_COLOR = 'cyan'
ACCENT_COLOR = 'green'
THINKING_VISIBLE = True


# ══════════════════════════════════════
# CONFIG MANAGER
# ══════════════════════════════════════

class ConfigManager:
    """Manages multi-provider configuration with YAML persistence."""

    def __init__(self):
        self.config = self._load()

    def _load(self) -> dict:
        """Load config from YAML file or create from defaults."""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = yaml.safe_load(f)
                if data and isinstance(data, dict) and 'providers' in data:
                    self._migrate_legacy(data)
                    return data
            except Exception:
                pass

        # Create default config
        config = {
            'version': 5,
            'active_provider': 'openrouter',
            'api_keys': {},
            'models': {},
            'providers': {},
        }
        for pid, pdef in DEFAULT_PROVIDERS.items():
            config['providers'][pid] = dict(pdef)
        return config

    def _migrate_legacy(self, config: dict):
        """Migrate old configs to new format."""
        if LEGACY_KEY_FILE.exists():
            try:
                key = LEGACY_KEY_FILE.read_text().strip()
                if key and not config.get('api_keys', {}).get('openrouter'):
                    if 'api_keys' not in config:
                        config['api_keys'] = {}
                    config['api_keys']['openrouter'] = key
            except Exception:
                pass

    def save(self):
        """Save config to YAML file."""
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                yaml.dump(self.config, f, default_flow_style=False,
                          allow_unicode=True, sort_keys=False)
            os.chmod(CONFIG_FILE, 0o600)
        except Exception:
            pass

    # ── Provider ────────────────────────

    @property
    def active_provider(self) -> str:
        return self.config.get('active_provider', 'openrouter')

    @active_provider.setter
    def active_provider(self, provider_id: str):
        self.config['active_provider'] = provider_id
        self.save()

    def get_provider_config(self, provider_id: str = None) -> dict:
        """Get full config dict for a provider (merged with defaults)."""
        pid = provider_id or self.active_provider
        stored = self.config.get('providers', {}).get(pid, {})
        defaults = DEFAULT_PROVIDERS.get(pid, {})
        merged = dict(defaults)
        merged.update(stored)
        return merged

    def get_all_providers(self) -> list[dict]:
        """Get list of all provider info dicts."""
        result = []
        for pid in DEFAULT_PROVIDERS:
            pconfig = self.get_provider_config(pid)
            api_key = self.get_api_key(pid)
            result.append({
                'id': pid,
                **pconfig,
                'has_key': bool(api_key),
                'active': pid == self.active_provider,
            })
        return result

    # ── API Key ─────────────────────────

    def get_api_key(self, provider_id: str = None) -> str:
        """Get API key: priority = saved config > env var > empty."""
        pid = provider_id or self.active_provider
        pconfig = self.get_provider_config(pid)

        saved = self.config.get('api_keys', {}).get(pid, '')
        if saved:
            return saved

        env_var = pconfig.get('api_key_env', '')
        if env_var:
            return os.environ.get(env_var, '')

        return ''

    def set_api_key(self, key: str, provider_id: str = None):
        """Save API key for a provider (file + env var)."""
        pid = provider_id or self.active_provider
        key = key.strip()
        if not key:
            return

        if 'api_keys' not in self.config:
            self.config['api_keys'] = {}
        self.config['api_keys'][pid] = key

        pconfig = self.get_provider_config(pid)
        env_var = pconfig.get('api_key_env', '')
        if env_var:
            os.environ[env_var] = key

        self.save()

    def delete_api_key(self, provider_id: str = None) -> bool:
        """Delete saved API key for a provider."""
        pid = provider_id or self.active_provider
        keys = self.config.get('api_keys', {})
        if pid in keys:
            del keys[pid]
            pconfig = self.get_provider_config(pid)
            env_var = pconfig.get('api_key_env', '')
            if env_var:
                os.environ.pop(env_var, None)
            self.save()
            return True
        return False

    # ── Model ───────────────────────────

    def get_provider_model(self, provider_id: str = None) -> str:
        """Get selected model for a provider (saved > default)."""
        pid = provider_id or self.active_provider
        saved = self.config.get('models', {}).get(pid, '')
        if saved:
            return saved
        return self.get_provider_config(pid).get('default_model', '')

    def set_provider_model(self, model: str, provider_id: str = None):
        """Save selected model for a provider."""
        pid = provider_id or self.active_provider
        if 'models' not in self.config:
            self.config['models'] = {}
        self.config['models'][pid] = model
        self.save()

    # ── Connectors ──────────────────────

    def get_connector_config(self, platform: str) -> dict:
        """Get connector config for a platform (telegram/discord)."""
        connectors = self.config.get('connectors', {})
        return connectors.get(platform, {})

    def set_connector_config(self, platform: str, key: str, value):
        """Set a connector config value."""
        if 'connectors' not in self.config:
            self.config['connectors'] = {}
        if platform not in self.config['connectors']:
            self.config['connectors'][platform] = {}
        self.config['connectors'][platform][key] = value
        self.save()

    def get_connector_token(self, platform: str) -> str:
        """Get token for a connector platform."""
        cfg = self.get_connector_config(platform)
        # Priority: saved config > env var
        env_map = {'telegram': 'TELEGRAM_BOT_TOKEN', 'discord': 'DISCORD_BOT_TOKEN'}
        saved = cfg.get('token', '')
        if saved:
            return saved
        return os.environ.get(env_map.get(platform, ''), '')

    def set_connector_token(self, platform: str, token: str):
        """Save connector token."""
        self.set_connector_config(platform, 'token', token.strip())

    # ── MCP Servers ─────────────────────

    def get_mcp_servers(self) -> dict:
        """Get all configured MCP servers."""
        return self.config.get('mcp_servers', {})

    def get_mcp_server(self, server_id: str) -> dict:
        """Get config for a specific MCP server."""
        servers = self.get_mcp_servers()
        return servers.get(server_id, {})

    def set_mcp_server(self, server_id: str, server_config: dict):
        """Add or update an MCP server config."""
        if 'mcp_servers' not in self.config:
            self.config['mcp_servers'] = {}
        self.config['mcp_servers'][server_id] = server_config
        self.save()

    def remove_mcp_server(self, server_id: str) -> bool:
        """Remove an MCP server config."""
        servers = self.get_mcp_servers()
        if server_id in servers:
            del self.config['mcp_servers'][server_id]
            self.save()
            return True
        return False

    def enable_mcp_server(self, server_id: str, enabled: bool = True):
        """Enable or disable an MCP server."""
        servers = self.get_mcp_servers()
        if server_id in servers:
            servers[server_id]['enabled'] = enabled
            self.config['mcp_servers'] = servers
            self.save()


def mask_key(key: str) -> str:
    """Mask API key for display."""
    if not key:
        return '(none)'
    if len(key) <= 10:
        return '****'
    return key[:7] + '****' + key[-4:]


# Global instance
cfg = ConfigManager()

# Cached usage status from enforce_gist() — avoids redundant API calls that can fail on Termux
_cached_usage_status = None

# Cached update info from enforce_gist() — populated at startup, read by the banner.
# Everything is driven by the registry Gist's "latest_version"; nothing is hardcoded
# in the UI, so bumping the Gist instantly changes every client.
#   None              -> not checked yet / check failed
#   {} (empty dict)   -> checked, already up to date
#   {'latest': '7.8'} -> checked, a newer version is available
_update_info = None


def _parse_version(v):
    """Parse a version string like '7.7' or 'v7.7.1' into a tuple of ints.

    Non-numeric/garbage segments are ignored so a malformed remote version
    can never crash the client. Returns () on total failure."""
    if not v:
        return ()
    s = str(v).strip().lstrip('vV').strip()
    parts = []
    for chunk in s.split('.'):
        num = ''.join(ch for ch in chunk if ch.isdigit())
        if num == '':
            break
        parts.append(int(num))
    return tuple(parts)


def is_newer_version(latest, current=CLIENT_VERSION):
    """Return True only when `latest` is strictly greater than `current`.

    Uses tuple comparison with zero-padding so '7.7' == '7.7.0' (NOT an update)
    while '7.8' or '7.7.1' > '7.7' (IS an update). Falls back to a safe string
    compare if either version can't be parsed."""
    lt = _parse_version(latest)
    ct = _parse_version(current)
    if not lt or not ct:
        # Couldn't parse — only flag as update if they differ literally
        return bool(latest) and str(latest).strip().lstrip('vV') != str(current).strip().lstrip('vV')
    n = max(len(lt), len(ct))
    lt = lt + (0,) * (n - len(lt))
    ct = ct + (0,) * (n - len(ct))
    return lt > ct


def get_update_info() -> dict:
    """Return cached update info populated by enforce_gist().

    Returns {} when up to date or not yet checked, or {'latest': <ver>,
    'current': <ver>} when a newer version is available."""
    return _update_info or {}


# ══════════════════════════════════════════════════════════════════════════
# BACKEND SYNC LAYER (rewritten)
#
# Design goals (fixes K-1, S-x from the audit):
#   1. NEVER kill the CLI because of a network/backend problem. The only
#      hard-stops allowed are deliberate administrative decisions that the
#      server explicitly asserted: banned == True or limit_exceeded == True.
#   2. Do not hammer the backend. enforce_gist() is called once per process
#      by __main__, and Agent.chat() only re-validates after a TTL.
#   3. Be the single source of truth for the effective username, which is
#      owned by the web dashboard (Firebase RTDB) — see resolve_username().
# ══════════════════════════════════════════════════════════════════════════

import json as _json
import urllib.request as _urlreq
import getpass as _getpass
import threading as _threading
import time as _time

# How long a successful permission check stays valid before we re-check.
ACCESS_CHECK_TTL = 300.0          # seconds (5 min)
# How long a resolved username stays cached before we re-read RTDB.
USERNAME_CACHE_TTL = 30.0         # seconds

_last_access_check = 0.0
_access_lock = _threading.Lock()
_offline_mode = False             # True once we fail to reach the backend

# Username cache: (value, fetched_at)
_username_cache = (None, 0.0)
_username_lock = _threading.Lock()

DEFAULT_FIREBASE_DB_URL = (
    "https://xbibzstorage-default-rtdb.asia-southeast1.firebasedatabase.app"
)


def _firebase_db_url() -> str:
    return os.environ.get("DEEPSEEK_FIREBASE_DB_URL", DEFAULT_FIREBASE_DB_URL).rstrip("/")


def _auth_file_path():
    return Path.home() / ".deepseek-cli" / "auth.json"


def _load_auth_session() -> dict:
    """Read the locally saved Firebase session (may be empty)."""
    try:
        p = _auth_file_path()
        if p.exists():
            with open(p) as f:
                return _json.load(f) or {}
    except Exception:
        pass
    return {}


def _local_fallback_username() -> str:
    """Last-resort identity when the user is not signed in."""
    try:
        return f"{_getpass.getuser()}@{socket.gethostname()}"
    except Exception:
        return "unknown-client"


def is_offline() -> bool:
    """True when the last backend interaction failed (informational only)."""
    return _offline_mode


# ── Username: the web dashboard owns it ────────────────────────────────────

def resolve_username(force: bool = False) -> str:
    """Return the effective username for this client.

    Authoritative order:
        1. Firebase RTDB  dscliUsers/<uid>/username   <- set by web dashboard
        2. username cached in the local auth.json session
        3. user@hostname

    The RTDB value is the single source of truth so that renaming the account
    on the web dashboard propagates to the CLI. Result is cached for
    USERNAME_CACHE_TTL to keep this cheap enough to call on every turn.
    """
    global _username_cache

    with _username_lock:
        cached, fetched_at = _username_cache
        if not force and cached and (_time.time() - fetched_at) < USERNAME_CACHE_TTL:
            return cached

    sess = _load_auth_session()
    uid = sess.get("uid") or sess.get("user_id") or ""
    local_name = sess.get("username") or ""

    remote_name = ""
    if uid:
        try:
            url = f"{_firebase_db_url()}/{'dscliUsers'}/{uid}/username.json"
            token = sess.get("id_token") or ""
            if token:
                url += f"?auth={token}"
            req = _urlreq.Request(url, headers={"User-Agent": "deepseek-cli/sync"})
            with _urlreq.urlopen(req, timeout=5) as resp:
                raw = resp.read().decode().strip()
            if raw and raw != "null":
                remote_name = _json.loads(raw) if raw.startswith('"') else raw.strip('"')
                if not isinstance(remote_name, str):
                    remote_name = ""
        except Exception:
            # Network/permission problem: fall back, never raise.
            remote_name = ""

    name = (remote_name or local_name or _local_fallback_username()).strip()

    # Keep auth.json in step so the welcome banner and offline runs agree.
    if remote_name and remote_name != local_name and sess:
        try:
            sess["username"] = remote_name
            p = _auth_file_path()
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                _json.dump(sess, f)
            os.chmod(p, 0o600)
        except Exception:
            pass

    with _username_lock:
        _username_cache = (name, _time.time())
    return name


def invalidate_username_cache():
    """Force the next resolve_username() to hit RTDB again."""
    global _username_cache
    with _username_lock:
        _username_cache = (None, 0.0)


# ── Registry / Worker resolution ───────────────────────────────────────────

def _resolve_api_url() -> tuple:
    """Resolve the Worker base URL from the registry Gist.

    Returns (api_url or None, latest_version or None). Never raises.
    """
    registry_gist_id = (os.environ.get("DEEPSEEK_GIST_ID", "")
                        or cfg.config.get("gist_id", "")
                        or _DEFAULT_GIST_ID)
    try:
        url = f"https://api.github.com/gists/{registry_gist_id}"
        headers = {"Accept": "application/vnd.github.v3+json",
                   "User-Agent": "deepseek-cli/sync"}
        gist_pat = (os.environ.get("DEEPSEEK_GIST_PAT", "")
                    or cfg.config.get("gist_pat", ""))
        if gist_pat:
            headers["Authorization"] = f"token {gist_pat}"
        req = _urlreq.Request(url, headers=headers)
        with _urlreq.urlopen(req, timeout=8) as response:
            gist_content = _json.loads(response.read().decode())
        file_data = gist_content.get("files", {}).get("endpoint.json", {})
        if not file_data:
            return None, None
        payload = _json.loads(file_data["content"])
        return payload.get("api_url"), payload.get("latest_version")
    except Exception:
        return None, None


def _get_public_ip() -> str:
    try:
        req = _urlreq.Request("https://api.ipify.org?format=json",
                              headers={"User-Agent": "deepseek-cli/sync"})
        with _urlreq.urlopen(req, timeout=5) as response:
            return _json.loads(response.read().decode()).get("ip", "127.0.0.1")
    except Exception:
        return "127.0.0.1"


def _print_block(lines, color="1;31"):
    bar = "█" * 50
    print(f"\n\033[{color}m{bar}\033[0m", file=sys.stderr)
    for ln in lines:
        print(f"\033[{color}m{ln}\033[0m", file=sys.stderr)
    print(f"\033[{color}m{bar}\033[0m\n", file=sys.stderr)


def _deny_and_exit(kind: str, detail: str = ""):
    """Only called for an explicit administrative denial from the server."""
    if kind == "banned":
        _print_block([
            "ACCESS DENIED! This account/IP has been BANNED.",
            "-" * 50,
            "To appeal, contact @XbibzOfficial on Telegram:",
            "  -> https://t.me/XbibzOfficial",
        ])
    else:
        _print_block([
            "ACCESS DENIED! Token limit has been exceeded.",
            detail,
            "-" * 50,
            "To request a limit increase, contact @XbibzOfficial:",
            "  -> https://t.me/XbibzOfficial",
        ])
    sys.exit(1)


def _build_client_payload(client_ip: str, username: str,
                          input_tokens: int = 0, output_tokens: int = 0,
                          last_tool: str = "initialization") -> dict:
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "unknown"
    sess = _load_auth_session()
    payload = {
        "ip": client_ip,
        "username": username,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "last_tool": last_tool,
        "status": "online",
        "version": CLIENT_VERSION,
        "hostname": hostname,
        "platform": sys.platform,
        "arch": platform.machine(),
        "os_release": platform.release(),
        "device_name": username,
    }
    # Bind telemetry to the authenticated account when available so the
    # backend can attribute usage to a uid instead of trusting the IP alone.
    uid = sess.get("uid") or ""
    if uid:
        payload["uid"] = uid
    token = sess.get("id_token") or ""
    if token:
        payload["id_token"] = token
    return payload


def enforce_gist(force: bool = False) -> dict:
    """Verify access permissions with the backend.

    Fail-OPEN on any infrastructure problem: if the registry, the Worker or
    the network is unavailable we log a single warning and let the user keep
    working. We only ever exit for an explicit `banned` / `limit_exceeded`
    verdict returned by the server.

    Returns the cached status dict (possibly empty when offline).
    """
    global _last_access_check, _cached_usage_status, _update_info, _offline_mode

    now = _time.time()
    with _access_lock:
        if (not force and _last_access_check
                and (now - _last_access_check) < ACCESS_CHECK_TTL):
            return _cached_usage_status or {}

    api_url, latest_version = _resolve_api_url()

    if latest_version and is_newer_version(latest_version, CLIENT_VERSION):
        _update_info = {"latest": str(latest_version).strip().lstrip("vV"),
                        "current": CLIENT_VERSION}
    elif latest_version:
        _update_info = {}

    if not api_url:
        if not _offline_mode:
            print("\033[93m[!] Backend unreachable — continuing in offline mode. "
                  "Usage will not be reported.\033[0m", file=sys.stderr)
        _offline_mode = True
        with _access_lock:
            _last_access_check = now
        return _cached_usage_status or {}

    client_ip = _get_public_ip()
    username = resolve_username()

    try:
        check_url = f"{api_url.rstrip('/')}/api/check?ip={client_ip}"
        req = _urlreq.Request(check_url, headers={"User-Agent": "deepseek-cli/sync"})
        with _urlreq.urlopen(req, timeout=8) as response:
            result = _json.loads(response.read().decode())
    except Exception as e:
        if not _offline_mode:
            print(f"\033[93m[!] Could not verify permissions ({e}) — "
                  f"continuing in offline mode.\033[0m", file=sys.stderr)
        _offline_mode = True
        with _access_lock:
            _last_access_check = now
        return _cached_usage_status or {}

    _offline_mode = False

    # ── Explicit administrative denials (the ONLY hard stops) ──
    if result.get("banned") is True:
        _deny_and_exit("banned")

    if result.get("limit_exceeded") is True:
        total_tokens = result.get("usage", 0) or 0
        token_limit = result.get("limit", 0) or 0
        try:
            update_gist_usage(0, 0, "limit_exceeded")
        except Exception:
            pass
        _deny_and_exit(
            "limit",
            f"Consumed: {total_tokens:,} / Limit: {token_limit:,} tokens.",
        )

    # ── Register this client, or repair a stale username ──
    # Registering only on first sight left pre-login records stuck under the
    # machine name (user@hostname) forever, because the authenticated name was
    # never pushed afterwards. Also sync whenever the backend's stored username
    # disagrees with the account name resolved from the dashboard.
    backend_username = (result.get("username") or "").strip()
    needs_register = not result.get("found", False)
    needs_rename = (
        bool(username)
        and backend_username != username
        and not username.startswith("cli_client_")
    )
    if needs_register or needs_rename:
        try:
            payload = _build_client_payload(client_ip, username)
            req_update = _urlreq.Request(
                f"{api_url.rstrip('/')}/api/update",
                data=_json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json",
                         "User-Agent": "deepseek-cli/sync"},
                method="POST",
            )
            with _urlreq.urlopen(req_update, timeout=8):
                pass
            if needs_rename:
                result["username"] = username
        except Exception:
            pass  # best-effort

    _cached_usage_status = {
        "ip": client_ip,
        "usage": result.get("usage", 0),
        "limit": result.get("limit", 0),
        "last_tool": result.get("last_tool", "-"),
        "total_calls": result.get("total_calls", 0),
        "username": result.get("username", "") or username,
        "banned": result.get("banned", False),
        "limit_exceeded": result.get("limit_exceeded", False),
        "found": result.get("found", False),
    }
    with _access_lock:
        _last_access_check = now
    return _cached_usage_status


def update_gist_usage(input_tokens: int, output_tokens: int, last_tool: str):
    """Report token usage to the Worker. Best-effort, never raises."""
    global _offline_mode
    api_url, _ = _resolve_api_url()
    if not api_url:
        _offline_mode = True
        return
    try:
        payload = _build_client_payload(
            _get_public_ip(), resolve_username(),
            input_tokens, output_tokens, last_tool,
        )
        req_update = _urlreq.Request(
            f"{api_url.rstrip('/')}/api/update",
            data=_json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     "User-Agent": "deepseek-cli/sync"},
            method="POST",
        )
        with _urlreq.urlopen(req_update, timeout=8):
            pass
        _offline_mode = False
    except Exception:
        _offline_mode = True


def get_usage_status() -> dict:
    """Returns cached usage status from the last successful check."""
    return _cached_usage_status or {}
