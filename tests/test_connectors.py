import json

from bibzcode.connectors import ConnectorManager, DiscordBot, TelegramBot, _safe_filename


def test_connectors_require_explicit_whitelist():
    manager = ConnectorManager()
    manager.telegram = TelegramBot("token", allowed_users=None)
    manager.telegram.validate_token = lambda: (True, "ok")
    ok, message = manager.start_telegram()
    assert not ok
    assert "whitelist" in message.lower()


def test_discord_poll_processes_messages_after_cursor(monkeypatch):
    seen = []
    bot = DiscordBot("token", "channel", allowed_users=["user-1"])
    bot._running = True
    bot._last_message_id = "100"

    def fake_api(method, endpoint, data=None, files=None, timeout=30):
        bot._running = False
        # API order is newest first; both messages are newer than cursor.
        return [
            {"id": "102", "content": "second", "author": {"id": "user-1", "username": "u", "bot": False}},
            {"id": "101", "content": "first", "author": {"id": "user-1", "username": "u", "bot": False}},
            {"id": "100", "content": "old", "author": {"id": "user-1", "username": "u", "bot": False}},
        ]

    bot._api = fake_api
    bot.agent_callback = lambda message, **kwargs: seen.append(message) or "ok"
    bot.send_message = lambda *args, **kwargs: True
    monkeypatch.setattr("bibzcode.connectors.time.sleep", lambda _: None)
    bot._poll_loop()
    assert seen == ["first", "second"]
    assert bot._last_message_id == "102"


def test_filename_sanitization_prevents_traversal():
    name = _safe_filename('../../.ssh/id_rsa')
    assert '/' not in name
    assert '..' not in name
    assert name == 'id_rsa'


def test_telegram_passes_current_reply_and_files_to_agent(tmp_path):
    captured = {}
    bot = TelegramBot('token', allowed_users=[7])
    bot._api = lambda *args, **kwargs: {'ok': True}
    bot.send_message = lambda *args, **kwargs: True
    bot.agent_callback = lambda message, **kwargs: captured.update(message=message, **kwargs) or 'done'

    def fake_download(spec, chat_id, user_id):
        path = tmp_path / spec['filename']
        path.write_bytes(b'data')
        return {
            'filename': spec['filename'], 'path': str(path),
            'mime_type': spec['mime_type'], 'size': 4,
            'relation': spec['relation'],
        }, None

    bot._download_telegram_file = fake_download
    bot._handle_update({'message': {
        'message_id': 20,
        'chat': {'id': 99, 'type': 'private'},
        'from': {'id': 7, 'first_name': 'Tester'},
        'text': 'tolong analisis file yang saya reply',
        'document': {'file_id': 'current-file', 'file_name': 'current.txt', 'mime_type': 'text/plain', 'file_size': 4},
        'reply_to_message': {
            'message_id': 19,
            'from': {'id': 8, 'first_name': 'Other'},
            'caption': 'original replied caption',
            'photo': [{'file_id': 'reply-photo', 'file_size': 4}],
        },
    }})

    assert captured['message'] == 'tolong analisis file yang saya reply'
    assert {item['relation'] for item in captured['files']} == {'current_message', 'replied_message'}
    context = json.loads(captured['reply_context'])
    assert context['replied_message']['text'] == 'original replied caption'
    assert context['current_message']['message_id'] == 20


def test_discord_poll_passes_reply_and_attachment(monkeypatch, tmp_path):
    captured = []
    bot = DiscordBot('token', 'channel', allowed_users=['user-1'])
    bot._running = True
    bot._last_message_id = '100'
    replied = {
        'id': '90', 'content': 'replied body',
        'author': {'id': 'user-2', 'username': 'other', 'bot': False},
        'attachments': [],
    }

    def fake_api(method, endpoint, data=None, files=None, timeout=30):
        bot._running = False
        return [{
            'id': '101', 'content': 'analyze this',
            'author': {'id': 'user-1', 'username': 'u', 'bot': False},
            'attachments': [{
                'id': 'a1', 'filename': 'report.txt', 'size': 4,
                'content_type': 'text/plain',
                'url': 'https://cdn.discordapp.com/attachments/x/y/report.txt',
            }],
            'referenced_message': replied,
        }]

    def fake_download(spec, user_id):
        path = tmp_path / spec['filename']
        path.write_bytes(b'data')
        return {
            'filename': spec['filename'], 'path': str(path),
            'mime_type': spec['mime_type'], 'size': 4,
            'relation': spec['relation'],
        }, None

    bot._api = fake_api
    bot._download_discord_attachment = fake_download
    bot.agent_callback = lambda message, **kwargs: captured.append((message, kwargs)) or 'ok'
    bot.send_message = lambda *args, **kwargs: True
    monkeypatch.setattr('bibzcode.connectors.time.sleep', lambda _: None)
    bot._poll_loop()

    message, kwargs = captured[0]
    assert message == 'analyze this'
    assert kwargs['files'][0]['relation'] == 'current_message'
    assert json.loads(kwargs['reply_context'])['replied_message']['content'] == 'replied body'


def test_telegram_download_is_bounded_private_and_token_free(monkeypatch, tmp_path):
    import bibzcode.connectors as connector_module

    requested = {}

    class Response:
        headers = {'content-length': '7'}
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def raise_for_status(self): return None
        def iter_bytes(self, size): return iter([b'payload'])

    def safe_request(_client, method, url, **kwargs):
        requested['url'] = url
        return Response()

    import bibzcode.net_policy as net_policy
    monkeypatch.setattr(connector_module, 'CONNECTOR_UPLOAD_ROOT', tmp_path)
    monkeypatch.setattr(net_policy, 'safe_httpx_request', safe_request)
    bot = TelegramBot('secret-bot-token', allowed_users=[1])
    bot._api = lambda *args, **kwargs: {'ok': True, 'result': {'file_path': 'docs/file.txt'}}
    item, error = bot._download_telegram_file({
        'file_id': 'f1', 'filename': '../../file.txt', 'mime_type': 'text/plain',
        'size': 7, 'relation': 'current_message',
    }, 2, 1)

    assert error is None
    assert item['filename'] == 'file.txt'
    assert item['path'].startswith(str(tmp_path))
    assert open(item['path'], 'rb').read() == b'payload'
    assert 'secret-bot-token' in requested['url']  # needed only for Telegram transport
    assert 'secret-bot-token' not in json.dumps(item)
