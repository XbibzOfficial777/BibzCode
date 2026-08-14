# BibzCode CLI v7.8.0 — Multi-Provider Configuration
# Manages 7 AI providers with YAML config file, API keys, and model selection
# NO TOOL LIMITS — all tools available at all times

import os
import platform
import secrets
import socket
import sys
from pathlib import Path

import yaml

from .version import __version__

CONFIG_DIR = Path.home() / '.bibzcode-cli'
CONFIG_FILE = CONFIG_DIR / 'config.yaml'
LEGACY_KEY_FILE = Path.home() / '.bibzcode_api_key'
CLIENT_VERSION = __version__

# Default Gist ID — embedded so every install auto-connects to dashboard backend
# The Gist is public, no secret. PAT stays optional (env/config only, NOT in code).
_DEFAULT_GIST_ID = "55a91f3ee47f659d21a58a80826ca827"

# ══════════════════════════════════════
# PROVIDER DEFINITIONS
# ══════════════════════════════════════

DEFAULT_PROVIDERS = {
    'openrouter': {
        'name': 'OpenRouter',
        'type': 'openai_compatible',
        'base_url': 'https://openrouter.ai/api/v1',
        'api_key_env': 'OPENROUTER_API_KEY',
        'default_model': 'bibzcode/bibzcode-r1-0528:free',
        'enabled': True,
        'supports_tools': True,
        'supports_streaming': True,
        'has_free_models': True,
        'get_key_url': 'https://openrouter.ai/keys',
        'extra_headers': {
            'HTTP-Referer': 'https://bibzcode-cli.local',
            'X-Title': f'BibzCode CLI v{__version__}',
        },
        'popular_models': [
            'bibzcode/bibzcode-r1-0528:free',
            'bibzcode/bibzcode-chat-v3-0324:free',
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

MAX_TOOL_ROUNDS = max(1, min(int(_stored_config.get('max_tool_rounds', 12) or 12), 50))
MAX_TOKENS = max(256, min(int(_stored_config.get('max_tokens', 16384) or 16384), 131072))
TEMPERATURE = max(0.0, min(float(_stored_config.get('temperature', 0.7)), 2.0))
TIMEOUT = max(5, min(int(_stored_config.get('http_timeout', 60) or 60), 300))
TOOL_TIMEOUT = max(5, min(int(_stored_config.get('tool_timeout', 120) or 120), 600))

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
            CONFIG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                os.chmod(CONFIG_DIR, 0o700)
            except OSError:
                pass
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

    def get_provider_config(self, provider_id: str | None = None) -> dict:
        """Get full config dict for a provider (merged with defaults)."""
        pid = provider_id or self.active_provider
        stored = self.config.get('providers', {}).get(pid, {})
        defaults = DEFAULT_PROVIDERS.get(pid, {})
        merged = dict(defaults)
        merged.update(stored)
        # A modified config file must not silently redirect provider API keys to
        # an attacker-controlled host. Custom endpoints are explicit opt-in.
        default_url = str(defaults.get('base_url', '')).rstrip('/')
        configured_url = str(merged.get('base_url', '')).rstrip('/')
        if default_url and configured_url != default_url and os.environ.get('BIBZCODE_ALLOW_CUSTOM_PROVIDER') != '1':
            merged['base_url'] = default_url
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

    def get_api_key(self, provider_id: str | None = None) -> str:
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

    def set_api_key(self, key: str, provider_id: str | None = None):
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

    def delete_api_key(self, provider_id: str | None = None) -> bool:
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

    def get_provider_model(self, provider_id: str | None = None) -> str:
        """Get selected model for a provider (saved > default)."""
        pid = provider_id or self.active_provider
        saved = self.config.get('models', {}).get(pid, '')
        if saved:
            return saved
        return self.get_provider_config(pid).get('default_model', '')

    def set_provider_model(self, model: str, provider_id: str | None = None):
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
    """Parse SemVer plus the project ``-rN``/PEP 440 ``.postN`` revision.

    The old digit-stripping parser interpreted ``7.8.0-r6`` as ``7.8.6``.
    Returning a fixed four-part tuple makes hotfix revisions comparable and
    ensures users on r2 are offered r6 even when the base version is unchanged.
    """
    if not v:
        return ()
    import re
    value = str(v).strip().lstrip('vV').strip()
    match = re.fullmatch(
        r'(\d+)\.(\d+)(?:\.(\d+))?(?:(?:-r|\.post)(\d+))?', value,
        flags=re.IGNORECASE,
    )
    if not match:
        return ()
    major, minor, patch, revision = match.groups()
    return int(major), int(minor), int(patch or 0), int(revision or 0)


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


DEFAULT_API_URL = "https://bibzcode.bibzflow.workers.dev"


def _backend_url() -> str:
    """Return the pinned production Worker endpoint.

    The Firebase ID token is sent to this origin, so runtime environment or
    config overrides must never be able to redirect it to another service.
    """
    value = (
        os.environ.get("BIBZCODE_API_URL", "")
        or cfg.config.get("api_url", "")
        or DEFAULT_API_URL
    ).rstrip("/")
    if value != DEFAULT_API_URL:
        raise RuntimeError('Custom BibzCode backends are not permitted')
    return DEFAULT_API_URL


def _worker_json(path: str, *, method: str = "GET", payload: dict | None = None,
                 timeout: int = 12) -> dict:
    import json
    import urllib.error
    import urllib.request

    from .auth import get_valid_id_token

    token = get_valid_id_token()
    if not token:
        raise RuntimeError("No valid Firebase session. Please log in again with: bzcli logout")
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": f"bibzcode-cli/{CLIENT_VERSION}",
        "Accept": "application/json",
    }
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{_backend_url()}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise RuntimeError(f"Backend HTTP {exc.code}: {body or exc.reason}") from exc


def _device_payload(input_tokens: int, output_tokens: int, last_tool: str) -> dict:
    import getpass
    input_tokens = max(0, min(int(input_tokens or 0), 1_000_000))
    output_tokens = max(0, min(int(output_tokens or 0), 1_000_000))
    try:
        hostname = socket.gethostname()
        username = f"{getpass.getuser()}@{hostname}"
    except Exception:
        hostname = "unknown"
        username = "unknown"
    return {
        "event_id": secrets.token_urlsafe(24),
        "username": username,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "last_tool": str(last_tool or "none")[:100],
        "status": "online",
        "version": CLIENT_VERSION,
        "hostname": hostname[:255],
        "platform": sys.platform[:100],
        "arch": platform.machine()[:100],
        "os_release": platform.release()[:255],
        "device_name": username[:255],
    }


def enforce_gist():
    """Authenticate with the Worker and enforce account/device access policy.

    The historical name is kept for compatibility, but this no longer reads or
    writes GitHub Gists directly and no longer trusts a client-supplied IP.
    """
    global _cached_usage_status, _update_info
    try:
        result = _worker_json("/api/check")
        try:
            version = _worker_json("/api/version")
            latest = version.get("latest_version")
            _update_info = ({"latest": str(latest).lstrip("vV"), "current": CLIENT_VERSION}
                            if latest and is_newer_version(latest, CLIENT_VERSION) else {})
        except Exception:
            _update_info = {}
    except Exception as exc:
        print(f"\033[91mFailed to verify access with the BibzCode backend: {exc}\033[0m", file=sys.stderr)
        raise SystemExit(1)

    if result.get("banned"):
        print("\n\033[1;31mACCESS DENIED: this account/device is banned.\033[0m", file=sys.stderr)
        print("\033[1;33mContact: https://t.me/XbibzOfficial\033[0m", file=sys.stderr)
        raise SystemExit(1)
    if result.get("limit_exceeded"):
        print("\n\033[1;31mACCESS DENIED: token limit exceeded.\033[0m", file=sys.stderr)
        print(f"\033[1;31mConsumed: {int(result.get('usage', 0)):,} / {int(result.get('limit', 0)):,}\033[0m", file=sys.stderr)
        raise SystemExit(1)

    if not result.get("found"):
        try:
            _worker_json("/api/update", method="POST", payload=_device_payload(0, 0, "initialization"))
            result = _worker_json("/api/check")
        except Exception as exc:
            print(f"\033[93mWarning: failed to register this device: {exc}\033[0m", file=sys.stderr)

    _cached_usage_status = {
        "ip": result.get("ip", "server-derived"),
        "usage": int(result.get("usage", 0) or 0),
        "limit": int(result.get("limit", 0) or 0),
        "last_tool": result.get("last_tool", "-"),
        "total_calls": int(result.get("total_calls", 0) or 0),
        "username": result.get("username", "Unknown"),
        "banned": bool(result.get("banned", False)),
        "limit_exceeded": bool(result.get("limit_exceeded", False)),
        "found": bool(result.get("found", False)),
    }


def update_gist_usage(input_tokens: int, output_tokens: int, last_tool: str):
    """Send a bounded, authenticated usage update to the Worker."""
    try:
        result = _worker_json(
            "/api/update", method="POST",
            payload=_device_payload(input_tokens, output_tokens, last_tool),
        )
        if _cached_usage_status and result.get("usage") is not None:
            _cached_usage_status["usage"] = int(result["usage"])
    except Exception:
        # Telemetry failure must not crash a completed answer.
        return


def get_usage_status() -> dict:
    """Return cached usage status from the latest successful access check."""
    return _cached_usage_status
