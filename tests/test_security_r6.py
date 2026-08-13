from deepseek import agent as agent_module
from deepseek.agent import AgentMetrics, safe_execute
from deepseek.auth import _build_session
from deepseek.config import _parse_version, is_newer_version
from deepseek.connectors import DiscordBot, TelegramBot
from deepseek.net_policy import url_policy_error
from deepseek.toolkit import ToolRegistry, redact_sensitive_text


def test_r6_versions_compare_as_revision_not_patch():
    assert _parse_version('7.8.0-r6') == (7, 8, 0, 6)
    assert _parse_version('7.8.0.post6') == (7, 8, 0, 6)
    assert is_newer_version('7.8.0-r6', '7.8.0-r5')
    assert not is_newer_version('7.8.0-r6', '7.8.0-r6')


def test_all_outside_path_metadata_operations_require_confirmation(tmp_path, monkeypatch):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    outside = tmp_path / 'outside.txt'
    outside.write_text('x')
    monkeypatch.setenv('DEEPSEEK_WORKSPACE', str(workspace))
    registry = ToolRegistry()
    for name in ('list_files', 'file_info', 'docx_info', 'pptx_info', 'xlsx_info', 'video_play'):
        assert registry.requires_confirmation(name, {'path': str(outside)}), name


def test_persistent_approval_is_workspace_scoped(tmp_path, monkeypatch):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    monkeypatch.setenv('DEEPSEEK_WORKSPACE', str(workspace))
    registry = ToolRegistry()
    assert registry.approval_key('write_file', {'path': str(workspace / 'ok.txt')})
    assert registry.approval_key('write_file', {'path': str(tmp_path / 'outside.txt')}) is None
    assert registry.approval_key('run_shell', {'command': 'echo ok'}) is None
    assert registry.approval_key('delete_file', {'path': str(workspace / 'ok.txt')}) is None


def test_dynamic_tool_schema_enforces_nested_constraints():
    registry = ToolRegistry()
    registry.register(
        'dynamic_test', 'dynamic',
        {
            'type': 'object',
            'properties': {
                'mode': {'type': 'string', 'enum': ['safe']},
                'items': {
                    'type': 'array', 'maxItems': 1,
                    'items': {
                        'type': 'object',
                        'properties': {'count': {'type': 'integer', 'maximum': 3}},
                        'required': ['count'],
                    },
                },
            },
            'required': ['mode', 'items'],
        },
        lambda args: 'ok',
    )
    _, error = registry.validate_args('dynamic_test', {'mode': 'unsafe', 'items': [{'count': 4}, {'count': 1}]})
    assert error and 'must be one of' in error and 'more than 1 items' in error


def test_secret_text_redaction_covers_known_token_shapes():
    text = redact_sensitive_text(
        'Authorization: Bearer abc.def.ghi token=supersecretvalue '
        + 'ghp_' + ('a' * 32) + ' ' + 'cfat_' + ('b' * 32)
    )
    assert 'supersecretvalue' not in text
    assert 'ghp_' not in text
    assert 'cfat_' not in text
    assert 'Bearer abc' not in text


def test_refresh_session_does_not_overwrite_email_with_empty_value():
    fresh = _build_session({'user_id': 'u', 'id_token': 'i', 'refresh_token': 'r', 'expires_in': '3600'}, 'name')
    assert 'email' not in fresh


def test_connector_classes_deny_empty_whitelist_direct_start():
    telegram = TelegramBot('token', allowed_users=None)
    telegram.start()
    assert not telegram.is_running
    assert 'whitelist' in telegram._last_error.lower()

    discord = DiscordBot('token', channel_id='1', allowed_users=None)
    discord.start()
    assert not discord.is_running
    assert 'whitelist' in discord._last_error.lower()


def test_private_network_policy_blocks_special_destinations(monkeypatch):
    monkeypatch.delenv('DEEPSEEK_ALLOW_PRIVATE_NETWORK', raising=False)
    assert url_policy_error('http://127.0.0.1/')
    assert url_policy_error('http://169.254.169.254/latest/meta-data')
    assert url_policy_error('http://localhost/')
    assert url_policy_error('file:///etc/passwd')


def test_isolated_csv_reader_returns_and_log_file_is_private(tmp_path, monkeypatch):
    csv_path = tmp_path / 'sample.csv'
    csv_path.write_text('a,b\n1,2\n')
    registry = ToolRegistry()
    handler = registry.tools['read_csv']['handler']
    result = safe_execute(
        handler, {'path': str(csv_path), 'max_rows': 10},
        timeout=20, tool_name='read_csv', process_isolated=True,
    )
    assert 'a' in result and '1' in result

    log_dir = tmp_path / 'logs'
    monkeypatch.setattr(agent_module, 'LOG_DIR', str(log_dir))
    metrics = AgentMetrics()
    metrics.record_turn({'user_message': 'private', 'tool_calls': 0, 'errors': 0, 'tools_used': []})
    log_file = next(log_dir.glob('*.json'))
    assert oct(log_dir.stat().st_mode & 0o777) == '0o700'
    assert oct(log_file.stat().st_mode & 0o777) == '0o600'
