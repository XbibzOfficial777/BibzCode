import json

import pytest

from bibzcode import ide_bridge
from bibzcode.config import ConfigManager
from bibzcode.memory import Memory, save_session
import bibzcode.memory as memory_module


def test_process_provider_and_model_overrides(monkeypatch):
    monkeypatch.setenv("BIBZCODE_PROVIDER", "groq")
    monkeypatch.setenv("BIBZCODE_MODEL", "test-model")
    config = ConfigManager()
    assert config.active_provider == "groq"
    assert config.get_provider_model("groq") == "test-model"


def test_environment_key_overrides_saved_key(monkeypatch):
    config = ConfigManager()
    config.config.setdefault("api_keys", {})["openrouter"] = "stale-saved-key"
    monkeypatch.setenv("OPENROUTER_API_KEY", "fresh-process-key")
    assert config.get_api_key("openrouter") == "fresh-process-key"


def test_bridge_provider_list_never_contains_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-secret-value")
    result = ide_bridge.providers_command(ConfigManager())
    encoded = json.dumps(result)
    assert "test-secret-value" not in encoded
    assert any(row["id"] == "openrouter" and row["hasKey"] for row in result["providers"])


def test_session_rename_export_and_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_module, "SESSIONS_DIR", str(tmp_path / "sessions"))
    session_id = "bzcli-0123456789ab"
    memory = Memory()
    memory.add_user("hello")
    memory.add_assistant("world")
    save_session(session_id, memory)

    renamed = ide_bridge.rename_session_command(session_id, "Owner Session")
    assert renamed["name"] == "Owner Session"

    assert ide_bridge.sessions_command("hello")["sessions"][0]["session_id"] == session_id
    assert ide_bridge.sessions_command("missing phrase")["sessions"] == []
    context = ide_bridge.session_context_command(session_id)
    assert context["fullHistory"] == 2
    assert context["roleCounts"]["user"] == 1

    target = tmp_path / "export.md"
    exported = ide_bridge.export_session_command(session_id, str(target))
    assert exported["ok"] is True
    assert "hello" in target.read_text("utf-8")

    assert ide_bridge.delete_session(session_id) is True
    assert ide_bridge.delete_session(session_id) is False


def test_session_compaction_uses_private_fallback_without_provider_key(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_module, "SESSIONS_DIR", str(tmp_path / "sessions"))
    session_id = "bzcli-111111111111"
    memory = Memory()
    for index in range(24):
        memory.add_user(f"request {index} token=private-{index}")
        memory.add_assistant(f"result {index}")
    save_session(session_id, memory)
    config = ConfigManager()
    config.config["compact_keep_recent"] = 8
    monkeypatch.setattr(config, "get_api_key", lambda _provider: "")

    result = ide_bridge.compact_session_command(config, session_id)
    assert result["compacted"] is True
    assert result["fallbackSummary"] is True
    loaded = memory_module.load_session(session_id)
    assert loaded.full_count() == 48
    assert len(loaded.archived_messages) == result["archivedMessages"]
    assert "private-0" not in loaded.conversation_summary
    assert "[REDACTED]" in loaded.conversation_summary


def test_bridge_rejects_unknown_provider():
    parser = ide_bridge.build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["validate", "--provider", "unknown"])


def test_export_rejects_missing_session(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_module, "SESSIONS_DIR", str(tmp_path / "sessions"))
    with pytest.raises(ValueError, match="session not found"):
        ide_bridge.export_session_command("bzcli-aaaaaaaaaaaa", str(tmp_path / "x.md"))
