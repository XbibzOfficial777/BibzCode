# BibzCode CLI v7.0 — Telegram & Discord Bot Connectors
# Connects the AI agent to Telegram and Discord for remote chat.
# Features:
#   - Telegram Bot: sends/receives messages, supports markdown, long msg splitting
#   - Discord Bot: sends/receives messages, supports markdown, embed fallback
#   - Per-platform token storage in config.yaml
#   - Background thread polling (no async/await complexity)
#   - Message relay: external -> agent.chat() -> reply back
#   - Graceful start/stop with status tracking
#   - Whitelist: restrict to specific user IDs (optional)

import json
import mimetypes
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

# Telegram support — uses httpx (same HTTP library used by providers.py)
# No separate 'requests' dependency needed
try:
    import httpx as _httpx_client
    _HTTPX_AVAILABLE = True
except ImportError:
    _httpx_client = None
    _HTTPX_AVAILABLE = False

TELEGRAM_LIB_AVAILABLE = _HTTPX_AVAILABLE
DISCORD_LIB_AVAILABLE = _HTTPX_AVAILABLE

CONNECTOR_UPLOAD_ROOT = Path.home() / '.bibzcode-cli' / 'uploads'
MAX_CONNECTOR_FILE_BYTES = max(1, int(os.environ.get('BIBZCODE_CONNECTOR_MAX_FILE_MB', '25'))) * 1024 * 1024
MAX_CONNECTOR_IDENTITY_BYTES = max(25, int(os.environ.get('BIBZCODE_CONNECTOR_MAX_IDENTITY_MB', '250'))) * 1024 * 1024
MAX_CONNECTOR_IDENTITY_FILES = max(10, int(os.environ.get('BIBZCODE_CONNECTOR_MAX_IDENTITY_FILES', '100')))
CONNECTOR_FILE_TTL_SECONDS = max(3600, int(os.environ.get('BIBZCODE_CONNECTOR_FILE_TTL_HOURS', '168')) * 3600)


def _safe_filename(filename: str, fallback: str = 'attachment.bin') -> str:
    name = Path(str(filename or '')).name
    name = re.sub(r'[^a-zA-Z0-9._()\- ]+', '_', name).strip(' .')
    if not name or name in {'.', '..'}:
        name = fallback
    stem, suffix = os.path.splitext(name)
    return f'{stem[:100]}{suffix[:20]}'


def _prune_attachment_directory(directory: Path) -> None:
    """Enforce per-identity age, count, and disk-usage retention limits."""
    now = time.time()
    files = []
    try:
        for path in directory.iterdir():
            try:
                if not path.is_file() or path.is_symlink():
                    continue
                stat = path.stat()
                if now - stat.st_mtime > CONNECTOR_FILE_TTL_SECONDS:
                    path.unlink(missing_ok=True)
                    continue
                files.append((path, stat.st_mtime, stat.st_size))
            except OSError:
                continue
        files.sort(key=lambda item: item[1], reverse=True)
        total = 0
        for index, (path, _mtime, size) in enumerate(files):
            total += size
            if index >= MAX_CONNECTOR_IDENTITY_FILES or total > MAX_CONNECTOR_IDENTITY_BYTES:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
    except OSError:
        pass


def _attachment_directory(platform_name: str, chat_id: str, user_id: str) -> Path:
    directory = CONNECTOR_UPLOAD_ROOT / platform_name / _safe_filename(chat_id, 'chat') / _safe_filename(user_id, 'user')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        current = directory
        while True:
            os.chmod(current, 0o700)
            if current == CONNECTOR_UPLOAD_ROOT:
                break
            current = current.parent
    except OSError:
        pass
    _prune_attachment_directory(directory)
    return directory


def _public_attachment(info: dict, local_path: Path) -> dict:
    return {
        'filename': _safe_filename(info.get('filename'), local_path.name),
        'path': str(local_path),
        'mime_type': info.get('mime_type') or mimetypes.guess_type(local_path.name)[0] or 'application/octet-stream',
        'size': local_path.stat().st_size,
        'caption': info.get('caption', ''),
        'relation': info.get('relation', 'current_message'),
    }


def _json_context(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)[:12_000]


def _redact_secret(text: str, secret: str) -> str:
    return str(text).replace(secret, '[REDACTED]') if secret else str(text)

# ── Telegram Bot API (pure httpx — no external deps needed) ──

class TelegramBot:
    """
    Telegram Bot using httpx HTTP client (no python-telegram-bot needed).
    Runs in a background thread, polls for updates, and relays messages
    to the agent's chat() method.

    Usage:
        bot = TelegramBot(token='123:ABC', agent_callback=my_func)
        bot.start()
        # ... messages flow ...
        bot.stop()
    """

    API_BASE = 'https://api.telegram.org/bot{token}'

    def __init__(self, token: str, agent_callback=None,
                 allowed_users=None, bot_name: str = ''):
        self.token = token
        self.agent_callback = agent_callback  # callable(user_message) -> str
        self.allowed_users = allowed_users  # list of int user IDs, or None = allow all
        self.bot_name = bot_name
        self._running = False
        self._thread = None
        self._offset = 0
        self._me = None  # bot info cache
        self._message_count = 0
        self._start_time = None
        self._last_error = ''
        self.last_chat_id = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def status(self) -> str:
        if not self.token:
            return 'No token'
        if self._running:
            uptime = ''
            if self._start_time:
                elapsed = time.time() - self._start_time
                mins = int(elapsed // 60)
                secs = int(elapsed % 60)
                uptime = f' ({mins}m {secs}s)'
            return f'Running{uptime} | {self._message_count} msgs'
        return 'Stopped'

    def _api(self, method: str, data: dict | None = None, files: dict | None = None,
             timeout: int = 30) -> dict:
        """Make a Telegram Bot API call."""
        if not _HTTPX_AVAILABLE or _httpx_client is None:
            self._last_error = 'httpx library not available. Run: pip install httpx'
            return {'ok': False, 'error': self._last_error}
        url = self.API_BASE.format(token=self.token) + '/' + method
        try:
            if files:
                resp = _httpx_client.post(url, data=data, files=files,
                                              timeout=timeout)
            elif data:
                resp = _httpx_client.post(url, json=data, timeout=timeout)
            else:
                resp = _httpx_client.get(url, timeout=timeout)
            result = resp.json()
            if not result.get('ok'):
                desc = result.get('description', 'Unknown error')
                self._last_error = desc
                return {'ok': False, 'error': desc}
            return result
        except Exception as e:
            error = _redact_secret(str(e), self.token)
            self._last_error = error
            return {'ok': False, 'error': error}

    def validate_token(self) -> tuple:
        """Validate the bot token. Returns (True, info_str) or (False, error_str)."""
        if not self.token:
            return False, 'No token provided'
        result = self._api('getMe')
        if result.get('ok'):
            self._me = result.get('result', {})
            name = self._me.get('first_name', 'Bot')
            username = self._me.get('username', '')
            return True, f'@{username} ({name})'
        return False, result.get('error', 'Invalid token')

    def get_me(self) -> dict:
        """Get bot info."""
        if self._me:
            return self._me
        result = self._api('getMe')
        if result.get('ok'):
            self._me = result.get('result', {})
            return self._me
        return {}

    def send_message(self, chat_id: int, text: str,
                     parse_mode: str = 'Markdown') -> bool:
        """Send a message to a Telegram chat."""
        # Telegram has a 4096 char limit per message
        max_len = 4096
        if len(text) <= max_len:
            return self._send_single(chat_id, text, parse_mode)

        # Split into chunks
        chunks = []
        remaining = text
        while remaining:
            if len(remaining) <= max_len:
                chunks.append(remaining)
                break
            # Find a good split point (newline, then space)
            split_at = remaining.rfind('\n', 0, max_len - 50)
            if split_at < max_len // 2:
                split_at = remaining.rfind(' ', 0, max_len - 50)
            if split_at < max_len // 2:
                split_at = max_len - 50
            chunks.append(remaining[:split_at])
            remaining = remaining[split_at:].lstrip('\n')

        for i, chunk in enumerate(chunks):
            if i == len(chunks) - 1:
                # Last chunk — may need different parse mode
                self._send_single(chat_id, chunk, parse_mode)
            else:
                self._send_single(chat_id, chunk, parse_mode)
            time.sleep(0.3)  # Avoid rate limiting

        return True

    def send_document(self, chat_id: int, file_path: str,
                      caption: str = '') -> bool:
        """Send a file as a document to a Telegram chat."""
        if not os.path.isfile(file_path):
            self._last_error = f'File not found: {file_path}'
            return False
        try:
            fname = os.path.basename(file_path)
            with open(file_path, 'rb') as f:
                files = {'document': (fname, f)}
                data = {'chat_id': chat_id}
                if caption:
                    data['caption'] = caption
                result = self._api('sendDocument', data=data, files=files)
                return result.get('ok', False)
        except Exception as e:
            self._last_error = str(e)
            return False

    def _send_single(self, chat_id: int, text: str, parse_mode: str) -> bool:
        """Send a single message, with markdown fallback."""
        # Clean markdown for Telegram (remove some unsupported syntax)
        clean_text = self._clean_markdown(text)

        result = self._api('sendMessage', data={
            'chat_id': chat_id,
            'text': clean_text,
            'parse_mode': parse_mode,
            'disable_web_page_preview': True,
        })

        if result.get('ok'):
            return True

        # Fallback: send without parse_mode
        if parse_mode != '':
            result = self._api('sendMessage', data={
                'chat_id': chat_id,
                'text': clean_text,
                'disable_web_page_preview': True,
            })
            return result.get('ok', False)

        return False

    def _clean_markdown(self, text: str) -> str:
        """Clean text for Telegram markdown compatibility."""
        # Remove markdown headers (## etc) — convert to bold
        text = re.sub(r'^#{1,6}\s+', '**', text, flags=re.MULTILINE)
        # Remove ``` code block language tags that Telegram doesn't support well
        text = re.sub(r'```\w*\n', '```\n', text)
        # Escape special chars that could break Telegram markdown
        # But be conservative — only escape if not already in a code block
        return text

    def _is_allowed(self, user_id: int) -> bool:
        """Deny by default even when TelegramBot is used without the manager."""
        if not self.allowed_users:
            return False
        try:
            return int(user_id) in {int(item) for item in self.allowed_users}
        except (TypeError, ValueError):
            return False

    def start(self):
        """Start the bot in a background thread."""
        if self._running:
            return
        if not self.token:
            return
        if not self.allowed_users:
            self._last_error = 'Refusing to start: configure an explicit Telegram user-ID whitelist.'
            return

        # Validate token first
        ok, info = self.validate_token()
        if not ok:
            self._last_error = info
            return

        self._running = True
        self._start_time = time.time()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the bot."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    def _poll_loop(self):
        """Background polling loop for Telegram updates."""
        while self._running:
            try:
                result = self._api('getUpdates', data={
                    'offset': self._offset,
                    'timeout': 30,  # Long polling
                    'allowed_updates': ['message'],
                }, timeout=35)

                if not result.get('ok'):
                    time.sleep(2)
                    continue

                updates = result.get('result', [])
                for update in updates:
                    self._offset = update.get('update_id', 0) + 1
                    self._handle_update(update)

            except Exception as e:
                self._last_error = str(e)
                if self._running:
                    time.sleep(3)

    @staticmethod
    def _telegram_file_specs(message: dict, relation: str) -> list[dict]:
        specs = []
        caption = message.get('caption', '') or ''
        document = message.get('document')
        if document:
            specs.append({
                'file_id': document.get('file_id'),
                'filename': document.get('file_name') or 'document.bin',
                'mime_type': document.get('mime_type') or 'application/octet-stream',
                'size': document.get('file_size', 0), 'caption': caption, 'relation': relation,
            })
        photos = message.get('photo') or []
        if photos:
            photo = photos[-1]
            specs.append({
                'file_id': photo.get('file_id'),
                'filename': f"photo_{message.get('message_id', 'unknown')}.jpg",
                'mime_type': 'image/jpeg', 'size': photo.get('file_size', 0),
                'caption': caption, 'relation': relation,
            })
        media_map = {
            'audio': ('audio.mp3', 'audio/mpeg'), 'voice': ('voice.ogg', 'audio/ogg'),
            'video': ('video.mp4', 'video/mp4'), 'animation': ('animation.mp4', 'video/mp4'),
            'video_note': ('video_note.mp4', 'video/mp4'),
        }
        for field, (fallback, mime) in media_map.items():
            media = message.get(field)
            if media:
                specs.append({
                    'file_id': media.get('file_id'),
                    'filename': media.get('file_name') or fallback,
                    'mime_type': media.get('mime_type') or mime,
                    'size': media.get('file_size', 0), 'caption': caption, 'relation': relation,
                })
        sticker = message.get('sticker')
        if sticker:
            suffix = '.webm' if sticker.get('is_video') else ('.tgs' if sticker.get('is_animated') else '.webp')
            specs.append({
                'file_id': sticker.get('file_id'),
                'filename': f"sticker_{message.get('message_id', 'unknown')}{suffix}",
                'mime_type': sticker.get('mime_type') or 'application/octet-stream',
                'size': sticker.get('file_size', 0), 'caption': caption, 'relation': relation,
            })
        return [spec for spec in specs if spec.get('file_id')]

    @staticmethod
    def _telegram_message_context(message: dict) -> dict:
        sender = message.get('from', {}) or {}
        chat = message.get('chat', {}) or {}
        context = {
            'message_id': message.get('message_id'),
            'date': message.get('date'),
            'sender': {
                'id': sender.get('id'), 'username': sender.get('username'),
                'first_name': sender.get('first_name'), 'last_name': sender.get('last_name'),
                'is_bot': sender.get('is_bot', False),
            },
            'chat': {'id': chat.get('id'), 'type': chat.get('type'), 'title': chat.get('title')},
            'text': message.get('text') or message.get('caption') or '',
            'media': [
                {key: value for key, value in spec.items() if key != 'file_id'}
                for spec in TelegramBot._telegram_file_specs(message, 'context_only')
            ],
        }
        for field in ('contact', 'location', 'venue', 'poll', 'quote', 'forward_origin', 'link_preview_options'):
            if message.get(field) is not None:
                context[field] = message[field]
        return context

    def _download_telegram_file(self, spec: dict, chat_id: int, user_id: int) -> tuple[dict | None, str | None]:
        expected_size = int(spec.get('size') or 0)
        if expected_size > MAX_CONNECTOR_FILE_BYTES:
            return None, f"{spec.get('filename')}: file exceeds {MAX_CONNECTOR_FILE_BYTES // (1024 * 1024)} MB limit"
        file_info = self._api('getFile', data={'file_id': spec['file_id']}, timeout=30)
        if not file_info.get('ok'):
            return None, f"{spec.get('filename')}: Telegram getFile failed"
        remote_path = file_info.get('result', {}).get('file_path')
        if not remote_path:
            return None, f"{spec.get('filename')}: Telegram returned no file path"
        directory = _attachment_directory('telegram', str(chat_id), str(user_id))
        filename = _safe_filename(spec.get('filename'), Path(remote_path).name or 'attachment.bin')
        destination = directory / f"{int(time.time())}_{uuid.uuid4().hex[:8]}_{filename}"
        download_url = f'https://api.telegram.org/file/bot{self.token}/{remote_path}'
        written = 0
        try:
            from .net_policy import safe_httpx_request
            with _httpx_client.Client(timeout=60, follow_redirects=False) as client:
                response = safe_httpx_request(
                    client, 'GET', download_url, stream=True,
                    max_redirects=5, max_response_bytes=MAX_CONNECTOR_FILE_BYTES,
                )
                with response:
                    response.raise_for_status()
                    with open(destination, 'wb') as output:
                        for chunk in response.iter_bytes(64 * 1024):
                            written += len(chunk)
                            if written > MAX_CONNECTOR_FILE_BYTES:
                                raise ValueError('download exceeded size limit')
                            output.write(chunk)
            os.chmod(destination, 0o600)
            return _public_attachment(spec, destination), None
        except Exception as exc:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
            return None, f'{filename}: download failed ({_redact_secret(str(exc), self.token)[:120]})'

    def _handle_update(self, update: dict):
        """Handle text, replies, metadata, and downloadable Telegram media."""
        message = update.get('message', {})
        if not message:
            return
        chat = message.get('chat', {}) or {}
        chat_id = chat.get('id', 0)
        sender = message.get('from', {}) or {}
        user_id = sender.get('id', 0)
        user_name = sender.get('first_name', 'Unknown')
        if not self._is_allowed(user_id):
            self.send_message(chat_id, 'Sorry, you are not authorized to use this bot.')
            return
        self.last_chat_id = chat_id

        text = (message.get('text') or message.get('caption') or '').strip()
        if text.startswith('/'):
            cmd = text.split()[0].lower()
            if cmd == '/start':
                self.send_message(chat_id,
                    "Hello! I'm your BibzCode CLI Agent.\n"
                    'Send text, reply to a message, or attach a supported file.\n\n'
                    'Commands: /start /status /clear /help')
                return
            if cmd == '/help':
                self.send_message(chat_id,
                    '**BibzCode CLI Agent**\n\n'
                    'I can read the message you reply to and analyze documents, images, audio/video metadata, '
                    'spreadsheets, presentations, PDFs, CSV, APK, and text files.\n\n'
                    'Commands: /status /clear /help')
                return
            if cmd == '/status':
                elapsed = time.time() - self._start_time if self._start_time else 0
                self.send_message(chat_id,
                    f'**Bot Status**\nState: Running\nMessages: {self._message_count}\n'
                    f'Uptime: {int(elapsed // 60)} minutes')
                return
            if cmd == '/clear':
                if self.agent_callback and hasattr(self.agent_callback, 'clear_memory'):
                    self.agent_callback.clear_memory('telegram', str(user_id), str(chat_id))
                    self.send_message(chat_id, 'Your isolated connector conversation was cleared.')
                else:
                    self.send_message(chat_id, 'Clear is not supported in this mode.')
                return

        replied = message.get('reply_to_message') or {}
        specs = self._telegram_file_specs(message, 'current_message')
        specs.extend(self._telegram_file_specs(replied, 'replied_message'))
        unique_specs = []
        seen_ids = set()
        for spec in specs:
            if spec['file_id'] not in seen_ids:
                seen_ids.add(spec['file_id'])
                unique_specs.append(spec)

        files = []
        file_errors = []
        for spec in unique_specs:
            downloaded, error = self._download_telegram_file(spec, chat_id, user_id)
            if downloaded:
                files.append(downloaded)
            if error:
                file_errors.append(error)

        connector_context = {
            'platform': 'telegram',
            'current_message': self._telegram_message_context(message),
            'replied_message': self._telegram_message_context(replied) if replied else None,
            'attachment_download_errors': file_errors,
        }
        has_structured_event = any(message.get(field) for field in ('contact', 'location', 'venue', 'poll', 'quote', 'forward_origin'))
        if not text and not files and not replied and not has_structured_event:
            return

        self._message_count += 1
        if not self.agent_callback:
            self.send_message(chat_id, 'Bot is running but no agent callback is configured.')
            return
        try:
            self._api('sendChatAction', data={'chat_id': chat_id, 'action': 'typing'})
            response = self.agent_callback(
                text, source='telegram', user=f'{user_name} (TG)',
                user_id=str(user_id), chat_id=str(chat_id), files=files,
                reply_context=_json_context(connector_context),
            )
            self.send_message(chat_id, str(response) if response else '(No response)')
        except Exception as exc:
            self.send_message(chat_id, f'Error: {str(exc)[:500]}')

# ── Discord Bot (using webhooks / REST — no discord.py dependency) ──

class DiscordBot:
    """
    Discord Bot using pure REST API (no discord.py needed).
    Uses a simple webhook approach or direct channel message sending.

    For receiving messages, it uses a simple polling approach via
    the bot's REST API.

    Usage:
        bot = DiscordBot(token='...', channel_id='...', agent_callback=my_func)
        bot.start()
        bot.stop()
    """

    API_BASE = 'https://discord.com/api/v10'

    def __init__(self, token: str, channel_id: str = '',
                 agent_callback=None, allowed_users=None):
        self.token = token
        self.channel_id = channel_id
        self.agent_callback = agent_callback
        self.allowed_users = allowed_users  # list of str user IDs, or None
        self._running = False
        self._thread = None
        self._me = None
        self._message_count = 0
        self._start_time = None
        self._last_message_id = None  # Track last processed message
        self._last_error = ''

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def status(self) -> str:
        if not self.token:
            return 'No token'
        if self._running:
            uptime = ''
            if self._start_time:
                elapsed = time.time() - self._start_time
                mins = int(elapsed // 60)
                secs = int(elapsed % 60)
                uptime = f' ({mins}m {secs}s)'
            return f'Running{uptime} | {self._message_count} msgs'
        return 'Stopped'

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bot {self.token}',
            'Content-Type': 'application/json',
            'User-Agent': 'BibzCodeCLI/7.0',
        }

    def _api(self, method: str, endpoint: str, data: dict | None = None,
             files: dict | None = None, timeout: int = 30) -> dict:
        """Make a Discord API call."""
        url = self.API_BASE + endpoint
        try:
            if files:
                headers = {
                    'Authorization': f'Bot {self.token}',
                    'User-Agent': 'BibzCodeCLI/7.0',
                }
                resp = _httpx_client.request(method, url, headers=headers,
                                             data=data, files=files, timeout=timeout)
            elif data:
                resp = _httpx_client.request(method, url, headers=self._headers(),
                                             json=data, timeout=timeout)
            else:
                resp = _httpx_client.request(method, url, headers=self._headers(),
                                             timeout=timeout)
            if resp.status_code == 204:
                return {'ok': True}
            try:
                result = resp.json()
            except Exception:
                result = {'ok': resp.status_code == 200}
            if resp.status_code >= 400:
                self._last_error = f'{resp.status_code}: {result}'
                return {'ok': False, 'error': f'{resp.status_code}: {result}'}
            if isinstance(result, dict):
                result['ok'] = True
            elif isinstance(result, list):
                return result  # list endpoint, no 'ok' wrapper needed
            return result
        except Exception as e:
            self._last_error = str(e)
            return {'ok': False, 'error': str(e)}

    def validate_token(self) -> tuple:
        """Validate the bot token. Returns (True, info_str) or (False, error_str)."""
        if not self.token:
            return False, 'No token provided'
        result = self._api('GET', '/users/@me')
        if result.get('ok'):
            self._me = result
            name = result.get('username', 'Bot')
            app_id = result.get('id', '?')
            return True, f'{name} (ID: {app_id})'
        return False, result.get('error', 'Invalid token')

    def send_message(self, text: str, channel_id: str = '') -> bool:
        """Send a message to a Discord channel."""
        ch_id = channel_id or self.channel_id
        if not ch_id:
            return False

        # Discord has a 2000 char limit
        max_len = 2000
        if len(text) <= max_len:
            return self._send_single(ch_id, text)

        # Split into chunks
        chunks = []
        remaining = text
        while remaining:
            if len(remaining) <= max_len:
                chunks.append(remaining)
                break
            split_at = remaining.rfind('\n', 0, max_len - 50)
            if split_at < max_len // 2:
                split_at = remaining.rfind(' ', 0, max_len - 50)
            if split_at < max_len // 2:
                split_at = max_len - 50
            chunks.append(remaining[:split_at])
            remaining = remaining[split_at:].lstrip('\n')

        for chunk in chunks:
            self._send_single(ch_id, chunk)
            time.sleep(0.5)

        return True

    def send_document(self, file_path: str, channel_id: str = '',
                      caption: str = '') -> bool:
        """Send a file to a Discord channel."""
        ch_id = channel_id or self.channel_id
        if not ch_id:
            return False
        if not os.path.isfile(file_path):
            self._last_error = f'File not found: {file_path}'
            return False
        try:
            fname = os.path.basename(file_path)
            with open(file_path, 'rb') as f:
                files = {'file': (fname, f)}
                payload = {}
                if caption:
                    payload['payload_json'] = json.dumps({'content': caption})
                result = self._api('POST', f'/channels/{ch_id}/messages',
                                   data=payload, files=files)
                return result.get('ok', False)
        except Exception as e:
            self._last_error = str(e)
            return False

    def _send_single(self, channel_id: str, text: str) -> bool:
        """Send a single Discord message."""
        # Discord uses markdown differently from Telegram
        # Convert some patterns for Discord compatibility
        clean = self._clean_for_discord(text)

        result = self._api('POST', f'/channels/{channel_id}/messages', data={
            'content': clean,
        })
        return result.get('ok', False)

    def _clean_for_discord(self, text: str) -> str:
        """Clean text for Discord markdown."""
        # Remove ```lang, keep ```
        text = re.sub(r'```\w*\n', '```\n', text)
        return text.strip()

    def get_guilds(self) -> list:
        """Get list of guilds the bot is in."""
        result = self._api('GET', '/users/@me/guilds')
        if result.get('ok'):
            return result
        return []

    def get_channels(self, guild_id: str) -> list:
        """Get channels in a guild."""
        result = self._api('GET', f'/guilds/{guild_id}/channels')
        if result.get('ok'):
            return [c for c in result if c.get('type') == 0]  # Text channels only
        return []

    def _is_allowed(self, user_id: str) -> bool:
        """Check if a user is allowed."""
        if self.allowed_users is None:
            return True
        return user_id in self.allowed_users

    def start(self):
        """Start the Discord bot in a background thread."""
        if self._running:
            return
        if not self.token:
            return
        if not self.channel_id:
            return
        if not self.allowed_users:
            self._last_error = 'Refusing to start: configure an explicit Discord user-ID whitelist.'
            return

        ok, info = self.validate_token()
        if not ok:
            self._last_error = info
            return

        self._running = True
        self._start_time = time.time()

        # Initialize: get the last message ID so we don't replay old messages
        init_result = self._api('GET',
            f'/channels/{self.channel_id}/messages?limit=1')
        if isinstance(init_result, list) and init_result:
            self._last_message_id = init_result[0].get('id')

        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the Discord bot."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

    @staticmethod
    def _discord_attachment_specs(message: dict, relation: str) -> list[dict]:
        specs = []
        for attachment in message.get('attachments') or []:
            url = attachment.get('url') or ''
            host = (urlparse(url).hostname or '').lower()
            if not url.startswith('https://') or not (host.endswith('.discordapp.com') or host.endswith('.discordapp.net')):
                continue
            specs.append({
                'url': url,
                'filename': attachment.get('filename') or 'attachment.bin',
                'mime_type': attachment.get('content_type') or 'application/octet-stream',
                'size': attachment.get('size', 0),
                'caption': attachment.get('description') or '',
                'relation': relation,
            })
        return specs

    @staticmethod
    def _discord_message_context(message: dict) -> dict:
        author = message.get('author', {}) or {}
        return {
            'message_id': message.get('id'),
            'timestamp': message.get('timestamp'),
            'edited_timestamp': message.get('edited_timestamp'),
            'author': {
                'id': author.get('id'), 'username': author.get('username'),
                'global_name': author.get('global_name'), 'bot': author.get('bot', False),
            },
            'content': message.get('content', ''),
            'attachments': [
                {key: value for key, value in spec.items() if key != 'url'}
                for spec in DiscordBot._discord_attachment_specs(message, 'context_only')
            ],
            'embeds': message.get('embeds') or [],
            'stickers': message.get('sticker_items') or [],
            'mentions': [
                {'id': item.get('id'), 'username': item.get('username'), 'global_name': item.get('global_name')}
                for item in (message.get('mentions') or [])
            ],
            'message_reference': message.get('message_reference'),
            'poll': message.get('poll'),
        }

    def _download_discord_attachment(self, spec: dict, user_id: str) -> tuple[dict | None, str | None]:
        expected_size = int(spec.get('size') or 0)
        filename = _safe_filename(spec.get('filename'), 'attachment.bin')
        if expected_size > MAX_CONNECTOR_FILE_BYTES:
            return None, f'{filename}: file exceeds {MAX_CONNECTOR_FILE_BYTES // (1024 * 1024)} MB limit'
        directory = _attachment_directory('discord', str(self.channel_id), str(user_id))
        destination = directory / f"{int(time.time())}_{uuid.uuid4().hex[:8]}_{filename}"
        written = 0
        try:
            from .net_policy import safe_httpx_request
            with _httpx_client.Client(timeout=60, follow_redirects=False) as client:
                response = safe_httpx_request(
                    client, 'GET', spec['url'], stream=True,
                    max_redirects=5, max_response_bytes=MAX_CONNECTOR_FILE_BYTES,
                )
                with response:
                    response.raise_for_status()
                    with open(destination, 'wb') as output:
                        for chunk in response.iter_bytes(64 * 1024):
                            written += len(chunk)
                            if written > MAX_CONNECTOR_FILE_BYTES:
                                raise ValueError('download exceeded size limit')
                            output.write(chunk)
            os.chmod(destination, 0o600)
            return _public_attachment(spec, destination), None
        except Exception as exc:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
            return None, f'{filename}: download failed ({str(exc)[:120]})'

    def _referenced_discord_message(self, message: dict) -> dict:
        referenced = message.get('referenced_message')
        if isinstance(referenced, dict):
            return referenced
        reference = message.get('message_reference') or {}
        message_id = reference.get('message_id')
        channel_id = reference.get('channel_id') or self.channel_id
        if not message_id or str(channel_id) != str(self.channel_id):
            return {}
        result = self._api('GET', f'/channels/{self.channel_id}/messages/{message_id}')
        return result if isinstance(result, dict) and result.get('id') else {}

    def _poll_loop(self):
        """Poll Discord while preserving replies and downloading attachments."""
        while self._running:
            try:
                if not self.channel_id:
                    time.sleep(5)
                    continue
                query = f'?after={self._last_message_id}&limit=10' if self._last_message_id else '?limit=10'
                result = self._api('GET', f'/channels/{self.channel_id}/messages{query}')
                if not isinstance(result, list):
                    time.sleep(3)
                    continue
                if self._last_message_id:
                    messages = [item for item in result if int(item.get('id', '0')) > int(self._last_message_id)]
                else:
                    messages = []
                messages.sort(key=lambda item: int(item.get('id', '0')))
                seen_any_new = False
                for message in messages:
                    message_id = message.get('id', '')
                    author = message.get('author', {}) or {}
                    author_id = str(author.get('id', ''))
                    self._last_message_id = message_id
                    seen_any_new = True
                    if author.get('bot', False) or not self._is_allowed(author_id):
                        continue

                    content = (message.get('content') or '').strip()
                    if content.startswith('/'):
                        command = content.split()[0].lower()
                        if command == '/help':
                            self.send_message(
                                '**BibzCode CLI Agent**\n\nSend text, reply to an existing message, '
                                'or attach a supported file.\nCommands: /status /clear /help')
                            continue
                        if command == '/status':
                            elapsed = time.time() - self._start_time if self._start_time else 0
                            self.send_message(f'Running · {self._message_count} messages · {int(elapsed // 60)} minutes')
                            continue
                        if command == '/clear':
                            if self.agent_callback and hasattr(self.agent_callback, 'clear_memory'):
                                self.agent_callback.clear_memory('discord', author_id, str(self.channel_id))
                                self.send_message('Your isolated connector conversation was cleared.')
                            continue

                    referenced = self._referenced_discord_message(message)
                    specs = self._discord_attachment_specs(message, 'current_message')
                    specs.extend(self._discord_attachment_specs(referenced, 'replied_message'))
                    files = []
                    file_errors = []
                    seen_urls = set()
                    for spec in specs:
                        if spec['url'] in seen_urls:
                            continue
                        seen_urls.add(spec['url'])
                        downloaded, error = self._download_discord_attachment(spec, author_id)
                        if downloaded:
                            files.append(downloaded)
                        if error:
                            file_errors.append(error)

                    connector_context = {
                        'platform': 'discord',
                        'current_message': self._discord_message_context(message),
                        'replied_message': self._discord_message_context(referenced) if referenced else None,
                        'attachment_download_errors': file_errors,
                    }
                    has_event = bool(
                        files or referenced or message.get('embeds') or message.get('sticker_items')
                        or message.get('poll') or message.get('attachments')
                    )
                    if not content and not has_event:
                        continue
                    self._message_count += 1
                    if not self.agent_callback:
                        continue
                    try:
                        response = self.agent_callback(
                            content, source='discord',
                            user=f"{author.get('username', 'Unknown')} (DC)",
                            user_id=author_id, chat_id=str(self.channel_id), files=files,
                            reply_context=_json_context(connector_context),
                        )
                        if response:
                            self.send_message(str(response))
                    except Exception as exc:
                        self.send_message(f'Error: {str(exc)[:500]}')
                time.sleep(1 if seen_any_new else 3)
            except Exception as exc:
                self._last_error = str(exc)
                if self._running:
                    time.sleep(3)

# ── Connector Manager ──

class ConnectorManager:
    """
    Manages Telegram and Discord bot connectors.
    Provides start/stop/status for both platforms.
    """

    def __init__(self):
        self.telegram: TelegramBot = None
        self.discord: DiscordBot = None
        self._agent_callback = None
        self._agent_memory = None

    def set_agent_callback(self, callback):
        """Set the agent chat callback function."""
        self._agent_callback = callback
        if self.telegram:
            self.telegram.agent_callback = callback
        if self.discord:
            self.discord.agent_callback = callback

    def set_agent_memory(self, memory):
        """Set the agent memory reference for /clear support."""
        self._agent_memory = memory

    def configure_telegram(self, token: str, allowed_users: list | None = None):
        """Configure and create Telegram bot instance."""
        if self.telegram and self.telegram.is_running:
            self.telegram.stop()

        self.telegram = TelegramBot(
            token=token,
            agent_callback=self._agent_callback,
            allowed_users=allowed_users,
        )
        return self.telegram

    def configure_discord(self, token: str, channel_id: str,
                          allowed_users: list | None = None):
        """Configure and create Discord bot instance."""
        if self.discord and self.discord.is_running:
            self.discord.stop()

        self.discord = DiscordBot(
            token=token,
            channel_id=channel_id,
            agent_callback=self._agent_callback,
            allowed_users=allowed_users,
        )
        return self.discord

    def start_telegram(self) -> tuple:
        """Start the Telegram bot. Returns (success, message)."""
        if not self.telegram:
            return False, 'Telegram not configured. Set token first.'
        if self.telegram.is_running:
            return False, 'Telegram is already running.'
        if not TELEGRAM_LIB_AVAILABLE:
            return False, 'Install httpx: pip install httpx'
        if not self.telegram.allowed_users:
            return False, 'Refusing to start without an explicit Telegram user-ID whitelist.'
        self.telegram.agent_callback = self._agent_callback
        self.telegram.start()
        if self.telegram.is_running:
            return True, f'Telegram bot started: {self.telegram.status}'
        return False, f'Failed to start: {self.telegram._last_error}'

    def stop_telegram(self) -> tuple:
        """Stop the Telegram bot."""
        if not self.telegram:
            return False, 'Telegram not configured.'
        self.telegram.stop()
        return True, 'Telegram bot stopped.'

    def start_discord(self) -> tuple:
        """Start the Discord bot. Returns (success, message)."""
        if not self.discord:
            return False, 'Discord not configured. Set token and channel ID first.'
        if self.discord.is_running:
            return False, 'Discord is already running.'
        if not DISCORD_LIB_AVAILABLE:
            return False, 'Install httpx: pip install httpx'
        if not self.discord.allowed_users:
            return False, 'Refusing to start without an explicit Discord user-ID whitelist.'
        self.discord.agent_callback = self._agent_callback
        self.discord.start()
        if self.discord.is_running:
            return True, f'Discord bot started: {self.discord.status}'
        return False, f'Failed to start: {self.discord._last_error}'

    def stop_discord(self) -> tuple:
        """Stop the Discord bot."""
        if not self.discord:
            return False, 'Discord not configured.'
        self.discord.stop()
        return True, 'Discord bot stopped.'

    def stop_all(self):
        """Stop all running connectors."""
        if self.telegram and self.telegram.is_running:
            self.telegram.stop()
        if self.discord and self.discord.is_running:
            self.discord.stop()

    def get_status(self) -> dict:
        """Get status of all connectors."""
        return {
            'telegram': {
                'configured': self.telegram is not None,
                'running': self.telegram.is_running if self.telegram else False,
                'status': self.telegram.status if self.telegram else 'Not configured',
                'token_set': bool(self.telegram and self.telegram.token),
            },
            'discord': {
                'configured': self.discord is not None,
                'running': self.discord.is_running if self.discord else False,
                'status': self.discord.status if self.discord else 'Not configured',
                'token_set': bool(self.discord and self.discord.token),
                'channel': self.discord.channel_id if self.discord else '',
            },
        }


# ── Global instance ──
connectors = ConnectorManager()
