from bibzcode.memory import Memory
from bibzcode import repl


def test_repl_starts_and_exits_without_multi_agent_scope_error(tmp_path, monkeypatch):
    import bibzcode.memory as memory_module

    monkeypatch.setattr(memory_module, 'SESSIONS_DIR', str(tmp_path / 'sessions'))
    monkeypatch.setattr(repl, 'show_banner', lambda: None)
    monkeypatch.setattr(repl, 'show_welcome', lambda *args, **kwargs: None)
    monkeypatch.setattr(repl, 'prompt_input', lambda **kwargs: '/exit')
    monkeypatch.setattr(repl.connector_manager, 'stop_all', lambda: None)

    repl.main(
        session_id='bzcli-0123456789ab',
        memory=Memory(),
        user={'username': 'test-user'},
    )
