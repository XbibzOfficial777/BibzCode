import os
import subprocess
import sys

import pytest

from bibzcode.agent import Agent
from bibzcode.mcp_client import MCPConnection
from bibzcode.mcp_tools import tool_get_datetime, tool_get_day_info
from bibzcode.memory import Memory, _session_path, delete_session, load_session
from bibzcode.toolkit import ToolRegistry, redact_sensitive_args


@pytest.fixture()
def registry(tmp_path, monkeypatch):
    monkeypatch.setenv("BIBZCODE_WORKSPACE", str(tmp_path))
    return ToolRegistry()


def test_optional_defaults_are_omitted(registry):
    args, error = registry.validate_args("generate_uuid", {})
    assert error is None
    assert args == {}
    assert len(registry.execute("generate_uuid", {}, source="cli", approved=True).splitlines()) == 1


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("random_number", {}),
        ("regex_test", {"pattern": "a", "text": "abc"}),
        ("get_calendar", {}),
        ("get_random_fact", {}),
    ],
)
def test_minimal_optional_tools_no_none_failures(registry, name, arguments):
    result = registry.execute(name, arguments, source="cli", approved=True)
    assert "NoneType" not in result
    assert not result.startswith("[ERROR]")
    assert "Unknown category: None" not in result


def test_datetime_month_and_zodiac_are_correct():
    date_output = tool_get_datetime({"timezone": "UTC", "format": "date"})
    # Month name must agree with ISO month produced by the same function's clock.
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    assert now.strftime("%B") in date_output
    day = tool_get_day_info({"date": "2026-08-12", "timezone": "UTC"})
    assert "Zodiac Sign: Leo" in day


def test_remote_policy_blocks_host_tools(registry, tmp_path):
    target = tmp_path / "secret.txt"
    target.write_text("secret")
    result = registry.execute("read_file", {"path": str(target)}, source="telegram")
    assert "disabled for remote connectors" in result
    result = registry.execute("delete_file", {"path": str(target)}, source="discord")
    assert "disabled for remote connectors" in result
    assert target.exists()


def test_remote_connector_can_only_read_exact_approved_attachment(monkeypatch, tmp_path):
    monkeypatch.setenv('HOME', str(tmp_path))
    upload_dir = tmp_path / '.bibzcode-cli' / 'uploads' / 'telegram' / 'chat' / 'user'
    upload_dir.mkdir(parents=True)
    approved = upload_dir / 'approved.txt'
    approved.write_text('connector payload')
    neighbor = upload_dir / 'neighbor.txt'
    neighbor.write_text('must stay blocked')
    registry = ToolRegistry()
    registry.allow_remote_attachment_paths([str(approved)])

    assert registry.execute('read_file', {'path': str(approved)}, source='telegram') == 'connector payload'
    denied = registry.execute('read_file', {'path': str(neighbor)}, source='telegram')
    assert 'not approved' in denied
    remote_names = {item['function']['name'] for item in registry.get_openai_tools(source='telegram')}
    assert 'read_file' in remote_names
    assert 'write_file' not in remote_names


def test_subagent_cannot_bypass_approval(registry, tmp_path):
    target = tmp_path / "out.txt"
    result = registry.execute("write_file", {"path": str(target), "content": "x"})
    assert "requires approval" in result
    assert not target.exists()


def test_local_approved_write_works(registry, tmp_path):
    target = tmp_path / "out.txt"
    result = registry.execute(
        "write_file", {"path": str(target), "content": "ok"},
        source="cli", approved=True,
    )
    assert target.read_text() == "ok"
    assert "Written" in result


def test_confirmation_accepts_ide_pipe_input_without_a_tty():
    script = "from bibzcode.ui import confirm_action; print('RESULT=' + confirm_action('write_file', {'path':'x'}))"
    completed = subprocess.run(
        [sys.executable, "-c", script], input="0", text=True,
        capture_output=True, timeout=10, check=True,
    )
    assert "RESULT=allow_once" in completed.stdout


def test_ide_change_preview_is_bounded_workspace_only_and_non_mutating(registry, tmp_path):
    target = tmp_path / "app.py"
    target.write_text("print('old')\n")
    preview = registry.ide_change_preview("edit_file", {
        "path": str(target), "old_string": "old", "new_string": "new",
    })
    assert preview["before"] == "print('old')\n"
    assert preview["after"] == "print('new')\n"
    assert target.read_text() == "print('old')\n"

    sensitive = tmp_path / ".env"
    sensitive.write_text("TOKEN=secret")
    assert registry.ide_change_preview("delete_file", {"path": str(sensitive)}) is None
    assert registry.ide_change_preview("write_file", {
        "path": str(tmp_path.parent / "outside.txt"), "content": "blocked",
    }) is None


def test_ide_change_protocol_requires_nonce_and_carries_bounded_preview(registry, tmp_path, monkeypatch, capsys):
    target = tmp_path / "code.py"
    target.write_text("old\n")
    args = {"path": str(target), "old_string": "old", "new_string": "new"}

    monkeypatch.setenv("BIBZCODE_IDE_PROTOCOL", "invalid")
    invalid_agent = Agent(Memory(), registry, DummyProvider(), "dummy", thinking_visible=False)
    invalid_agent._emit_ide_change_preview("edit_file", args)
    assert capsys.readouterr().out == ""

    import base64
    import json
    nonce = "a" * 48
    monkeypatch.setenv("BIBZCODE_IDE_PROTOCOL", nonce)
    agent = Agent(Memory(), registry, DummyProvider(), "dummy", thinking_visible=False)
    assert "BIBZCODE_IDE_PROTOCOL" not in os.environ
    agent._emit_ide_change_preview("edit_file", args)
    frame = capsys.readouterr().out.strip()
    prefix = f"__BIBZCODE_IDE_CHANGE__:{nonce}:"
    assert frame.startswith(prefix)
    payload = json.loads(base64.b64decode(frame[len(prefix):]))
    assert payload["before"] == "old\n"
    assert payload["after"] == "new\n"
    assert len(payload["id"]) == 24
    assert target.read_text() == "old\n"


def test_private_and_local_urls_are_blocked(registry):
    _, _, error = registry.prepare_execution(
        "web_fetch", {"url": "http://127.0.0.1:8080/private"},
        source="cli", approved=True,
    )
    assert error and "blocked" in error.lower()


def test_sensitive_argument_redaction_is_recursive():
    value = {"username": "u", "password": "p", "nested": {"api_key": "k"}}
    assert redact_sensitive_args(value) == {
        "username": "u", "password": "[REDACTED]",
        "nested": {"api_key": "[REDACTED]"},
    }


def test_session_path_rejects_traversal(tmp_path, monkeypatch):
    import bibzcode.memory as memory_module
    monkeypatch.setattr(memory_module, "SESSIONS_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        _session_path("../../victim")
    with pytest.raises(ValueError):
        _session_path("/tmp/victim")
    assert load_session("../../victim") is None
    assert delete_session("../../victim") is False


class DummyProvider:
    supports_tools = False
    default_model = "dummy"
    name = "dummy"


class DummyPlanner:
    provider = None


def test_provider_switch_updates_planner(registry):
    agent = Agent(Memory(), registry, DummyProvider(), "dummy", thinking_visible=False)
    agent.planner = DummyPlanner()
    replacement = DummyProvider()
    replacement.name = "replacement"
    agent.set_provider(replacement)
    assert agent.provider is replacement
    assert agent.planner.provider is replacement


def test_mcp_environment_is_allowlisted(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-leak")
    monkeypatch.setenv("PATH", os.environ.get("PATH", ""))
    monkeypatch.setenv("ONLY_FOR_SERVER", "server-secret")
    connection = MCPConnection.__new__(MCPConnection)
    connection.config = {"env_key": "ONLY_FOR_SERVER", "env_value": "server-secret"}
    connection.error = None
    env = MCPConnection._get_env(connection)
    assert env["ONLY_FOR_SERVER"] == "server-secret"
    assert "OPENAI_API_KEY" not in env
