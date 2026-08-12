from deepseek.toolkit import ToolRegistry


def test_remote_read_is_limited_to_exact_downloaded_attachment(monkeypatch, tmp_path):
    monkeypatch.setenv('HOME', str(tmp_path))
    root = tmp_path / '.deepseek-cli' / 'uploads' / 'telegram' / 'chat' / 'user'
    root.mkdir(parents=True)
    approved = root / 'approved.txt'
    approved.write_text('connector payload')
    blocked = root / 'blocked.txt'
    blocked.write_text('host secret')

    registry = ToolRegistry()
    registry.allow_remote_attachment_paths([str(approved)])
    assert registry.execute('read_file', {'path': str(approved)}, confirm=False,
                            source='telegram') == 'connector payload'
    denied = registry.execute('read_file', {'path': str(blocked)}, confirm=False,
                              source='telegram')
    assert 'not approved' in denied

    names = {item['function']['name']
             for item in registry.get_openai_tools(source='telegram')}
    assert 'read_file' in names
    assert 'write_file' not in names


def test_remote_without_attachment_never_sees_host_read_tools():
    registry = ToolRegistry()
    names = {item['function']['name']
             for item in registry.get_openai_tools(source='discord')}
    assert 'read_file' not in names
    assert 'run_shell' not in names
    assert 'live_search' in names
