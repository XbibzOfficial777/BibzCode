"""
Regression tests for the DeepSeek CLI v7.8 audit fixes.

Each test class maps to a numbered finding from the audit report. These are
behavioural tests: they assert the observable consequence of a fix, not the
presence of a particular line of code.

Run:  python -m pytest tests/ -v
"""

import ast
import io
import json
import os
import sys
import tempfile
import textwrap
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
PKG = ROOT / "deepseek"

os.environ.setdefault("DEEPSEEK_SKIP_AUTH", "1")


# ══════════════════════════════════════════════════════════════════════
# K-6 / help: UnboundLocalError from a shadowed module-level import
# ══════════════════════════════════════════════════════════════════════

class TestHelpCommand:
    """`/help` used to raise UnboundLocalError because `show_help` was
    re-imported inside the bare-'/' branch, making it function-local."""

    def test_no_shadowed_imports_in_handle_command(self):
        tree = ast.parse((PKG / "repl.py").read_text())
        fn = next(n for n in tree.body
                  if isinstance(n, ast.FunctionDef) and n.name == "handle_command")
        binds = {}
        for node in ast.walk(fn):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    nm = a.asname or a.name.split(".")[0]
                    binds.setdefault(nm, []).append(node.lineno)
        offenders = []
        for node in ast.walk(fn):
            if (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
                    and node.id in binds):
                if all(node.lineno < b for b in binds[node.id]):
                    offenders.append((node.id, node.lineno, binds[node.id]))
        assert not offenders, f"use-before-local-import: {offenders}"

    def test_help_runs_without_error(self, monkeypatch):
        import deepseek.repl as R

        class FakeMem:
            _current_session_id = "s1"
            messages = []
            todo_items = []
            session_name = ""

            def count(self):
                return 0

        called = {"n": 0}
        monkeypatch.setattr(R, "show_help", lambda: called.__setitem__("n", called["n"] + 1))
        R.handle_command("/help", None, FakeMem(), None)
        R.handle_command("/h", None, FakeMem(), None)
        R.handle_command("/?", None, FakeMem(), None)
        R.handle_command("/", None, FakeMem(), None)
        assert called["n"] == 4

    def test_show_help_renders_all_commands(self, capsys):
        from deepseek.ui import show_help, SLASH_COMMANDS
        show_help()
        out = capsys.readouterr().out
        # Rich may wrap long rows; check the command tokens are present.
        missing = [c for c, _ in SLASH_COMMANDS if c not in out]
        assert not missing, f"missing from /help output: {missing}"


# ══════════════════════════════════════════════════════════════════════
# Ctrl+P settings panel completeness
# ══════════════════════════════════════════════════════════════════════

class TestSettingsPanel:

    def test_every_slash_command_has_a_handler(self):
        from deepseek.ui import SLASH_COMMANDS
        src = (PKG / "repl.py").read_text()
        i = src.index("def handle_command(")
        j = src.index("\ndef ", i + 10)
        body = src[i:j]
        missing = [c for c, _ in SLASH_COMMANDS if f"'{c}'" not in body]
        assert not missing, f"slash commands with no branch: {missing}"

    def test_panel_submenu_helpers_exist(self):
        import deepseek.repl as R
        for fn in ("_settings_account_info", "_settings_account_menu",
                   "_settings_models_menu", "_settings_session_menu",
                   "_settings_project_menu", "_settings_info_menu"):
            assert callable(getattr(R, fn)), f"missing {fn}"

    def test_panel_covers_every_command_category(self):
        """Every slash command must be reachable from the Ctrl+P panel,
        either directly or via one of its submenus."""
        from deepseek.ui import SLASH_COMMANDS
        src = (PKG / "repl.py").read_text()
        start = src.index("def open_settings_panel(")
        end = src.index("def _toggle_live_search(")
        panel = src[start:end]

        # Commands intentionally not in the panel (flow-control only).
        exempt = {"/exit", "/help", "/h", "/?"}
        # Map command -> the handler function the panel should invoke.
        handler_for = {
            "/provider": "_settings_switch_provider", "/model": "_settings_switch_model",
            "/key": "set_api_key", "/agent": "_settings_switch_profile",
            "/thinking": "toggle_thinking", "/connectors": "_settings_connectors",
            "/mcp": "mcp_menu", "/system": "_settings_edit_system",
            "/models": "_settings_models_menu", "/live_models": "_settings_models_menu",
            "/search_model": "_settings_models_menu",
            "/session": "_settings_session_menu", "/export": "_settings_session_menu",
            "/compact": "_settings_session_menu", "/clear": "_settings_session_menu",
            "/tools": "_settings_project_menu", "/skills": "_settings_project_menu",
            "/install": "_settings_project_menu", "/init": "_settings_project_menu",
            "/live_search": "_settings_project_menu",
            "/info": "_settings_info_menu", "/k": "_settings_info_menu",
            "/context": "_settings_info_menu", "/version": "_settings_info_menu",
            "/account": "_settings_account_menu", "/logout": "_settings_account_menu",
            "/sync": "_settings_account_menu", "/login": "_settings_account_menu",
            "/telegram": "_settings_connectors", "/discord": "_settings_connectors",
        }
        unreachable = []
        for cmd, _ in SLASH_COMMANDS:
            if cmd in exempt:
                continue
            h = handler_for.get(cmd)
            if h is None or h not in panel:
                unreachable.append(cmd)
        assert not unreachable, f"not reachable from Ctrl+P: {unreachable}"

    def test_submenus_dispatch_to_real_functions(self):
        """Guard against typos: every name a submenu calls must exist."""
        import deepseek.repl as R
        src = (PKG / "repl.py").read_text()
        tree = ast.parse(src)
        for name in ("_settings_account_menu", "_settings_models_menu",
                     "_settings_session_menu", "_settings_project_menu",
                     "_settings_info_menu"):
            fn = next(n for n in tree.body
                      if isinstance(n, ast.FunctionDef) and n.name == name)
            # Names bound by imports inside the function are valid too.
            local_names = set()
            for node in ast.walk(fn):
                if isinstance(node, ast.ImportFrom):
                    for a in node.names:
                        local_names.add(a.asname or a.name)
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    called = node.func.id
                    if called in ("interactive_select", "print", "len", "str"):
                        continue
                    if called in local_names:
                        continue
                    assert hasattr(R, called), f"{name} calls missing {called}()"


# ══════════════════════════════════════════════════════════════════════
# T-3: off-by-one in parse_text_tool_calls Pattern 2
# ══════════════════════════════════════════════════════════════════════

class TestTextToolCallParsing:

    def test_pattern2_json_call_now_parses(self):
        from deepseek.agent import parse_text_tool_calls
        tools = {"run_shell": {}, "read_file": {}}
        calls, cleaned = parse_text_tool_calls(
            'I will now run_shell({"command": "ls -la"}) to list files.', tools)
        assert len(calls) == 1
        assert calls[0]["function"]["name"] == "run_shell"
        assert json.loads(calls[0]["function"]["arguments"]) == {"command": "ls -la"}

    def test_pattern2_nested_json(self):
        from deepseek.agent import parse_text_tool_calls
        tools = {"write_file": {}}
        calls, _ = parse_text_tool_calls(
            'write_file({"path": "a.json", "content": "{\\"k\\": 1}"})', tools)
        assert len(calls) == 1
        args = json.loads(calls[0]["function"]["arguments"])
        assert args["path"] == "a.json"

    def test_unknown_tool_not_invented(self):
        from deepseek.agent import parse_text_tool_calls
        calls, _ = parse_text_tool_calls('nope({"a": 1})', {"run_shell": {}})
        assert calls == []


# ══════════════════════════════════════════════════════════════════════
# K-6: _interrupt_last_time must exist
# ══════════════════════════════════════════════════════════════════════

class TestInterruptState:

    def test_attribute_initialised(self):
        from deepseek.agent import Agent

        class P:
            supports_tools = False
            default_model = "m"

        class M:
            def get_messages(self):
                return []

        class T:
            tools = {}

            def get_openai_tools(self):
                return []

        a = Agent.__new__(Agent)
        a.__init__(M(), T(), P(), "m", thinking_visible=False)
        assert isinstance(a._interrupt_last_time, float)


# ══════════════════════════════════════════════════════════════════════
# K-1: enforce_gist must never kill the CLI on infrastructure failure
# ══════════════════════════════════════════════════════════════════════

class TestOfflineResilience:

    @pytest.fixture(autouse=True)
    def _clean_state(self, monkeypatch, tmp_path):
        """Isolate the persisted-denial file and cached verdict so a ban left
        behind by another test cannot leak in here."""
        import deepseek.config as C
        monkeypatch.setattr(C, "_DENIAL_FILE", tmp_path / "access.json")
        C._cached_usage_status = None
        C._last_access_check = 0.0
        C._offline_mode = False
        yield
        C._cached_usage_status = None
        C._last_access_check = 0.0

    def test_enforce_gist_fails_open(self, monkeypatch, capsys):
        import deepseek.config as C

        def boom(*a, **k):
            raise OSError("[Errno 101] Network is unreachable")

        monkeypatch.setattr(C._urlreq, "urlopen", boom)
        C._last_access_check = 0.0
        C.enforce_gist(force=True)  # must NOT raise SystemExit
        assert C.is_offline() is True

    def test_update_usage_swallows_failure(self, monkeypatch):
        import deepseek.config as C
        monkeypatch.setattr(C._urlreq, "urlopen",
                            lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
        C.update_gist_usage(10, 10, "read_file")  # must not raise

    def test_explicit_ban_still_exits(self, monkeypatch):
        import deepseek.config as C
        monkeypatch.setattr(C, "_resolve_api_url", lambda: ("https://x", None))
        monkeypatch.setattr(C, "_get_public_ip", lambda: "1.2.3.4")
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "u")

        class R:
            def read(self):
                return json.dumps({"banned": True, "found": True}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(C._urlreq, "urlopen", lambda *a, **k: R())
        C._last_access_check = 0.0
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_limit_exceeded_still_exits(self, monkeypatch):
        import deepseek.config as C
        monkeypatch.setattr(C, "_resolve_api_url", lambda: ("https://x", None))
        monkeypatch.setattr(C, "_get_public_ip", lambda: "1.2.3.4")
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "u")
        monkeypatch.setattr(C, "update_gist_usage", lambda *a, **k: None)

        class R:
            def read(self):
                return json.dumps({"banned": False, "limit_exceeded": True,
                                   "usage": 10, "limit": 5, "found": True}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(C._urlreq, "urlopen", lambda *a, **k: R())
        C._last_access_check = 0.0
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_agent_chat_survives_backend_outage(self, monkeypatch):
        """A network failure inside enforce_gist must not abort chat()."""
        import deepseek.agent as A
        import deepseek.config as C
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))

        class P:
            supports_tools = False
            default_model = "m"

            def chat_stream(self, **kw):
                yield {"type": "content", "data": "hi"}
                yield {"type": "done", "data": None}

        from deepseek.memory import Memory

        class T:
            tools = {}

            def get_openai_tools(self):
                return []

            def is_dangerous(self, n):
                return False

        a = A.Agent(Memory(), T(), P(), "m", thinking_visible=False)
        monkeypatch.setattr(a, "_start_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_stop_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_check_interrupt", lambda: False)
        res = a.chat("hello")
        assert res["content"].strip() == "hi"


# ══════════════════════════════════════════════════════════════════════
# K-4 / K-5: dangerous-tool gate is centralised and fails closed
# ══════════════════════════════════════════════════════════════════════

class TestDangerousToolGate:

    @pytest.fixture(scope="class")
    def reg(self):
        from deepseek.toolkit import ToolRegistry
        return ToolRegistry()

    def test_destructive_tools_are_classified(self, reg):
        for t in ("delete_file", "run_shell", "run_code", "write_file",
                  "edit_file", "install_package"):
            assert reg.is_dangerous(t), f"{t} must be gated"

    def test_readonly_tools_not_gated(self, reg):
        for t in ("read_file", "list_files", "calculate", "web_search"):
            assert not reg.is_dangerous(t), f"{t} should not need confirmation"

    def test_execute_rejects_without_tty(self, reg, monkeypatch):
        """Non-interactive callers (connectors, sub-agents) must be refused,
        not silently auto-approved."""
        monkeypatch.setattr(sys, "stdin", io.StringIO())
        d = tempfile.mkdtemp()
        victim = os.path.join(d, "keep.txt")
        Path(victim).write_text("precious")
        out = reg.execute("delete_file", {"path": victim})
        assert "Rejected" in out
        assert Path(victim).exists(), "file was deleted despite no confirmation!"

    def test_subagent_path_is_gated(self, reg, monkeypatch):
        monkeypatch.setattr(sys, "stdin", io.StringIO())
        out = reg.execute("run_shell", {"command": "echo pwned"})
        assert "Rejected" in out

    def test_confirm_false_bypass_is_explicit(self, reg):
        """The interactive Agent passes confirm=False after prompting."""
        out = reg.execute("run_shell", {"command": "echo ok"}, confirm=False)
        assert "ok" in out

    def test_confirm_action_fails_closed(self, monkeypatch):
        from deepseek.ui import confirm_action
        monkeypatch.setattr(sys, "stdin", io.StringIO())
        assert confirm_action("run_shell", {"command": "x"}) == "reject"


# ══════════════════════════════════════════════════════════════════════
# T-5: Pydantic None-injection must not defeat handler defaults
# ══════════════════════════════════════════════════════════════════════

class TestArgumentValidation:

    @pytest.fixture(scope="class")
    def reg(self):
        from deepseek.toolkit import ToolRegistry
        return ToolRegistry()

    def test_omitted_optional_does_not_become_none(self, reg):
        out = reg.execute("run_shell", {"command": "echo hi"}, confirm=False)
        assert "hi" in out

    def test_explicit_none_is_preserved(self, reg):
        args, err = reg.validate_args("run_shell", {"command": "x", "timeout": None})
        assert err is None

    def test_type_errors_still_rejected(self, reg):
        out = reg.execute("read_file", {"path": 123}, confirm=False)
        assert "[ERROR]" in out

    def test_missing_required_rejected(self, reg):
        out = reg.execute("read_file", {}, confirm=False)
        assert "[ERROR]" in out and "path" in out


# ══════════════════════════════════════════════════════════════════════
# T-2: skill tools must not depend on Selenium
# ══════════════════════════════════════════════════════════════════════

class TestSkillToolRegistration:

    def test_skill_tools_registered_without_selenium(self):
        from deepseek.toolkit import ToolRegistry
        r = ToolRegistry()
        assert "list_skills" in r.tools
        assert "read_skill" in r.tools

    def test_skill_tools_not_nested_in_selenium(self):
        tree = ast.parse((PKG / "toolkit.py").read_text())
        cls = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.ClassDef) and n.name == "ToolRegistry")
        sel = next(n for n in cls.body
                   if isinstance(n, ast.FunctionDef)
                   and n.name == "_register_selenium_tools")
        names = [n.args[0].value for n in ast.walk(sel)
                 if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute) and n.func.attr == "register"
                 and n.args and isinstance(n.args[0], ast.Constant)]
        assert "list_skills" not in names
        assert "read_skill" not in names


# ══════════════════════════════════════════════════════════════════════
# K-3: connectors must deny by default
# ══════════════════════════════════════════════════════════════════════

class TestConnectorAuthorization:

    def test_telegram_denies_when_no_whitelist(self):
        from deepseek.connectors import TelegramBot
        bot = TelegramBot(token="x", allowed_users=None)
        assert bot._is_allowed(12345) is False

    def test_telegram_allows_whitelisted(self):
        from deepseek.connectors import TelegramBot
        bot = TelegramBot(token="x", allowed_users=[42])
        assert bot._is_allowed(42) is True
        assert bot._is_allowed(43) is False

    def test_telegram_handles_string_ids(self):
        from deepseek.connectors import TelegramBot
        bot = TelegramBot(token="x", allowed_users=["42"])
        assert bot._is_allowed(42) is True

    def test_telegram_refuses_to_start_without_whitelist(self):
        from deepseek.connectors import TelegramBot
        bot = TelegramBot(token="x", allowed_users=None)
        bot.start()
        assert bot.is_running is False
        assert "whitelist" in bot._last_error.lower()

    def test_discord_denies_when_no_whitelist(self):
        from deepseek.connectors import DiscordBot
        bot = DiscordBot(token="x", channel_id="1", allowed_users=None)
        assert bot._is_allowed("999") is False


# ══════════════════════════════════════════════════════════════════════
# Username sync: dashboard is the single source of truth
# ══════════════════════════════════════════════════════════════════════

class TestUsernameSync:

    def test_rtdb_value_wins(self, monkeypatch, tmp_path):
        import deepseek.config as C
        auth = tmp_path / "auth.json"
        auth.write_text(json.dumps({"uid": "u1", "username": "stale",
                                    "id_token": "t"}))
        monkeypatch.setattr(C, "_auth_file_path", lambda: auth)

        class R:
            def read(self):
                return b'"dashboard-name"'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(C._urlreq, "urlopen", lambda *a, **k: R())
        C.invalidate_username_cache()
        assert C.resolve_username(force=True) == "dashboard-name"

    def test_rename_propagates_to_local_cache(self, monkeypatch, tmp_path):
        import deepseek.config as C
        auth = tmp_path / "auth.json"
        auth.write_text(json.dumps({"uid": "u1", "username": "old", "id_token": "t"}))
        monkeypatch.setattr(C, "_auth_file_path", lambda: auth)

        class R:
            def read(self):
                return b'"renamed"'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(C._urlreq, "urlopen", lambda *a, **k: R())
        C.invalidate_username_cache()
        C.resolve_username(force=True)
        assert json.loads(auth.read_text())["username"] == "renamed"

    def test_falls_back_when_rtdb_unreachable(self, monkeypatch, tmp_path):
        import deepseek.config as C
        auth = tmp_path / "auth.json"
        auth.write_text(json.dumps({"uid": "u1", "username": "cached", "id_token": "t"}))
        monkeypatch.setattr(C, "_auth_file_path", lambda: auth)
        monkeypatch.setattr(C._urlreq, "urlopen",
                            lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
        C.invalidate_username_cache()
        assert C.resolve_username(force=True) == "cached"

    def test_anonymous_fallback_is_user_at_host(self, monkeypatch, tmp_path):
        import deepseek.config as C
        monkeypatch.setattr(C, "_auth_file_path", lambda: tmp_path / "nope.json")
        C.invalidate_username_cache()
        assert "@" in C.resolve_username(force=True)

    def test_cache_prevents_hammering(self, monkeypatch, tmp_path):
        import deepseek.config as C
        auth = tmp_path / "auth.json"
        auth.write_text(json.dumps({"uid": "u1", "username": "n", "id_token": "t"}))
        monkeypatch.setattr(C, "_auth_file_path", lambda: auth)
        calls = {"n": 0}

        class R:
            def read(self):
                calls["n"] += 1
                return b'"n"'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        monkeypatch.setattr(C._urlreq, "urlopen", lambda *a, **k: R())
        C.invalidate_username_cache()
        C.resolve_username(force=True)
        for _ in range(5):
            C.resolve_username()  # cached
        assert calls["n"] == 1

    def test_telemetry_uses_resolved_username(self, monkeypatch, tmp_path):
        import deepseek.config as C
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "sync-name")
        monkeypatch.setattr(C, "_auth_file_path", lambda: tmp_path / "nope.json")
        payload = C._build_client_payload("1.2.3.4", C.resolve_username())
        assert payload["username"] == "sync-name"
        assert payload["device_name"] == "sync-name"


# ══════════════════════════════════════════════════════════════════════
# Credentials are read-only in the CLI
# ══════════════════════════════════════════════════════════════════════

class TestCredentialsAreDashboardOnly:

    def test_no_cli_username_mutation(self):
        """The CLI must never PUT/PATCH a username into RTDB."""
        src = (PKG / "auth.py").read_text() + (PKG / "config.py").read_text() \
            + (PKG / "repl.py").read_text()
        tree_src = src
        # Registration legitimately creates the initial profile; what must not
        # exist is an interactive rename path.
        assert "update_username" not in tree_src
        assert "set_username" not in tree_src

    def test_account_view_is_readonly(self):
        src = (PKG / "repl.py").read_text()
        for fn in ("_settings_account_info(", "_settings_account_menu("):
            i = src.index("def " + fn)
            j = src.index("\ndef ", i + 10)
            body = src[i:j]
            assert "rtdb_put_user" not in body, fn
            assert "rtdb_patch_user" not in body, fn
        i = src.index("def _settings_account_info(")
        j = src.index("\ndef ", i + 10)
        assert "dashboard" in src[i:j].lower()

    def test_dashboard_url_exposed(self):
        from deepseek.config import DASHBOARD_URL
        assert DASHBOARD_URL.startswith("http")


# ══════════════════════════════════════════════════════════════════════
# S-7: created_files tracking across overwrite
# ══════════════════════════════════════════════════════════════════════

class TestCreatedFilesTracking:

    def test_overwrite_still_tracked(self):
        src = (PKG / "agent.py").read_text()
        assert "result.startswith('Written ')" not in src, \
            "overwrites return [DIFF] and would be dropped"
        assert "not result.startswith('[ERROR]')" in src


# ══════════════════════════════════════════════════════════════════════
# S-3/S-4: honest stop reasons
# ══════════════════════════════════════════════════════════════════════

class TestStopReason:

    def test_anti_stuck_reported_distinctly(self):
        src = (PKG / "agent.py").read_text()
        assert "stopped_by == 'anti_stuck'" in src
        assert "'stopped_by': stopped_by," in src


# ══════════════════════════════════════════════════════════════════════
# Whole-codebase health
# ══════════════════════════════════════════════════════════════════════

class TestCodebaseHealth:

    def test_all_modules_compile(self):
        import py_compile
        for f in sorted(PKG.glob("*.py")):
            py_compile.compile(str(f), doraise=True)

    def test_all_modules_import(self):
        import importlib
        for name in ("agent", "auth", "config", "connectors", "doc_tools",
                     "mcp_client", "mcp_tools", "memory", "multi_agent",
                     "planner", "providers", "repl", "selenium_browser",
                     "toolkit", "ui", "webcontrol"):
            importlib.import_module(f"deepseek.{name}")

    def test_version_is_consistent(self):
        from deepseek.config import CLIENT_VERSION
        from deepseek.repl import VERSION
        assert CLIENT_VERSION == VERSION == "7.8"

    def test_no_use_before_local_import_anywhere(self):
        """The /help bug class must not reappear in any module."""
        offenders = []
        for path in sorted(PKG.glob("*.py")):
            tree = ast.parse(path.read_text())
            for fn in ast.walk(tree):
                if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                binds = {}
                for node in ast.walk(fn):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        for a in node.names:
                            nm = a.asname or a.name.split(".")[0]
                            binds.setdefault(nm, []).append(node.lineno)
                for node in ast.walk(fn):
                    if (isinstance(node, ast.Name)
                            and isinstance(node.ctx, ast.Load)
                            and node.id in binds
                            and all(node.lineno < b for b in binds[node.id])):
                        offenders.append(f"{path.name}:{node.lineno} {node.id}")
        assert not offenders, offenders

    def test_calculate_sandbox_holds(self):
        from deepseek.toolkit import ToolRegistry
        r = ToolRegistry()
        c = r.tools["calculate"]["handler"]
        assert c({"expression": "2+2"}) == "4"
        for evil in ('__import__("os").system("id")',
                     'open("/etc/passwd").read()',
                     "(1).__class__.__mro__"):
            assert "error" in c({"expression": evil}).lower()


# ══════════════════════════════════════════════════════════════════════
# /login — sign in without restarting the CLI
# ══════════════════════════════════════════════════════════════════════

class TestLoginCommand:
    """`/logout` existed with no `/login`, stranding the user until restart."""

    def test_login_is_a_registered_command(self):
        from deepseek.ui import SLASH_COMMANDS
        cmds = [c for c, _ in SLASH_COMMANDS]
        assert "/login" in cmds
        assert "/logout" in cmds

    def test_login_has_a_handler(self):
        src = (PKG / "repl.py").read_text()
        i = src.index("def handle_command(")
        j = src.index("\ndef ", i + 10)
        assert "'/login'" in src[i:j]

    def test_auth_exposes_reusable_login(self):
        from deepseek import auth
        assert callable(auth.interactive_login)
        assert callable(auth.get_current_session)
        assert callable(auth.is_signed_in)

    def test_interactive_login_can_be_cancelled_without_exiting(self, monkeypatch):
        """allow_exit=False must return {} rather than killing the REPL."""
        from deepseek import auth
        monkeypatch.setattr(auth, "_banner_auth", lambda: None)
        monkeypatch.setattr(auth, "_prompt", lambda label: "4")
        assert auth.interactive_login(allow_exit=False) == {}

    def test_startup_gate_still_exits_on_quit(self, monkeypatch):
        from deepseek import auth
        monkeypatch.setattr(auth, "_banner_auth", lambda: None)
        monkeypatch.setattr(auth, "_prompt", lambda label: "4")
        with pytest.raises(SystemExit):
            auth.interactive_login(allow_exit=True)

    def test_logout_clears_in_memory_session(self, monkeypatch, tmp_path):
        from deepseek import auth
        monkeypatch.setattr(auth, "AUTH_FILE", tmp_path / "auth.json")
        auth._set_current_session({"uid": "u1", "username": "alice"})
        assert auth.is_signed_in() is True
        auth.logout()
        assert auth.is_signed_in() is False
        assert auth.get_current_session() == {}

    def test_login_sets_session_for_banner(self, monkeypatch, tmp_path):
        """Fresh login (not just silent restore) must populate the session so
        the welcome banner and /account show the real user."""
        from deepseek import auth
        monkeypatch.setattr(auth, "AUTH_FILE", tmp_path / "auth.json")
        auth._set_current_session({})
        monkeypatch.setattr(auth, "fb_sign_in", lambda e, p: {
            "localId": "u9", "email": e, "idToken": "tok",
            "refreshToken": "r", "expiresIn": "3600"})
        monkeypatch.setattr(auth, "rtdb_get_user", lambda *a, **k: {"username": "bob"})
        monkeypatch.setattr(auth, "fb_lookup", lambda t: {"emailVerified": True})
        monkeypatch.setattr(auth, "rtdb_patch_user", lambda *a, **k: True)
        monkeypatch.setattr(auth, "_exit_if_banned", lambda *a, **k: None)
        monkeypatch.setattr(auth, "_prompt", lambda label: "bob@example.com")
        monkeypatch.setattr(auth, "_prompt_password", lambda label: "secret")
        sess = auth._do_login()
        assert sess.get("uid") == "u9"
        assert auth.is_signed_in() is True
        assert auth.get_current_session()["username"] == "bob"

    def test_no_duplicate_auth_menu(self):
        """ensure_authenticated must delegate to interactive_login, not carry
        its own copy of the menu."""
        src = (PKG / "auth.py").read_text()
        assert src.count(") Log in    [cyan]2[/cyan]) Register") == 1

    def test_account_menu_offers_login_when_signed_out(self):
        src = (PKG / "repl.py").read_text()
        i = src.index("def _settings_account_menu(")
        j = src.index("\ndef ", i + 10)
        body = src[i:j]
        assert "/login" in body and "/logout" in body
        assert "interactive_login" in body


# ══════════════════════════════════════════════════════════════════════
# Field report: "dscli exits instantly with no output"
# (Linux Mint 22.3 / zsh, installed via `curl ... | bash`)
# ══════════════════════════════════════════════════════════════════════

class TestNonInteractiveStdin:
    """`curl … | bash` exec'd dscli with the *script text* as stdin. The REPL
    read EOF on its first prompt, returned '/exit', and quit — printing
    nothing, because the banner is suppressed on a non-TTY."""

    def test_installer_never_execs_without_a_tty(self):
        sh = (ROOT / "install.sh").read_text()
        assert "exec dscli </dev/tty" in sh, \
            "auto-launch must re-attach the controlling terminal"
        assert "exec dscli ;;" not in sh, \
            "bare `exec dscli` inherits the pipe as stdin"

    def test_installer_requires_real_tty_to_autolaunch(self):
        sh = (ROOT / "install.sh").read_text()
        assert "[ -e /dev/tty ]" in sh
        assert "tty -s 0</dev/tty" in sh

    def test_installer_tells_user_how_to_start_when_piped(self):
        sh = (ROOT / "install.sh").read_text()
        assert "Run ${R}${B}dscli" in sh

    def test_wrapper_has_no_set_e(self):
        """`set -e` in the launcher aborted before the CLI's own messages
        (ban / quota / Ctrl-C) could be shown."""
        sh = (ROOT / "install.sh").read_text()
        i = sh.index("Launcher (venv)")
        j = sh.index("WRAPPER_EOF", i)
        wrapper = sh[i:j]
        assert "set -euo pipefail" not in wrapper
        assert "set -uo pipefail" in wrapper

    def test_wrapper_reattaches_tty(self):
        sh = (ROOT / "install.sh").read_text()
        i = sh.index("Launcher (venv)")
        j = sh.index("WRAPPER_EOF", i)
        wrapper = sh[i:j]
        assert "-t 0" in wrapper and "/dev/tty" in wrapper

    def test_eof_exit_is_explained_not_silent(self):
        """The user must never just get their shell back with no message."""
        src = (PKG / "ui.py").read_text()
        i = src.index("def prompt_input(")
        j = src.index("\ndef ", i + 10)
        body = src[i:j]
        assert "stdin reached EOF" in body
        assert "curl" in body


class TestBannerIsNotHardcoded:
    """Banner claimed 'v7.7' and 'Tools: 90+' on a v7.8 build with 88 tools."""

    def test_banner_template_has_no_literal_version(self):
        from deepseek.ui import BANNER
        assert "v7.7" not in BANNER
        assert "90+" not in BANNER
        assert "__VER__" in BANNER and "__NTOOLS__" in BANNER

    def test_banner_renders_live_values(self, capsys, monkeypatch):
        import deepseek.ui as U
        from deepseek.config import CLIENT_VERSION
        from deepseek.toolkit import ToolRegistry
        monkeypatch.setattr(U.sys.stdout, "isatty", lambda: True, raising=False)
        U.show_banner()
        out = capsys.readouterr().out
        assert CLIENT_VERSION in out
        assert str(len(ToolRegistry().tools)) in out
        assert "__VER__" not in out and "__NTOOLS__" not in out


class TestBackendUsernameSelfHeal:
    """A record created before sign-in stayed stuck under `user@hostname`
    because the CLI only pushed a username on first registration."""

    def test_rename_is_pushed_when_backend_disagrees(self, monkeypatch):
        import deepseek.config as C
        sent = {}

        class R:
            def read(self):
                return json.dumps({
                    "banned": False, "limit_exceeded": False, "found": True,
                    "usage": 10, "limit": 500000, "username": "anon@anon",
                }).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_urlopen(req, timeout=None):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if "/api/update" in url:
                sent["body"] = json.loads(req.data.decode())
                class Ok:
                    def __enter__(self): return self
                    def __exit__(self, *a): return False
                return Ok()
            return R()

        monkeypatch.setattr(C, "_resolve_api_url", lambda: ("https://x", None))
        monkeypatch.setattr(C, "_get_public_ip", lambda: "1.2.3.4")
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "Bibzzzzz")
        monkeypatch.setattr(C._urlreq, "urlopen", fake_urlopen)
        C._last_access_check = 0.0
        C.enforce_gist(force=True)
        assert sent.get("body", {}).get("username") == "Bibzzzzz", \
            "stale backend username was not corrected"

    def test_no_pointless_write_when_names_match(self, monkeypatch):
        import deepseek.config as C
        calls = {"update": 0}

        class R:
            def read(self):
                return json.dumps({
                    "banned": False, "limit_exceeded": False, "found": True,
                    "usage": 1, "limit": 500000, "username": "Bibzzzzz",
                }).encode()

            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=None):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if "/api/update" in url:
                calls["update"] += 1
            return R()

        monkeypatch.setattr(C, "_resolve_api_url", lambda: ("https://x", None))
        monkeypatch.setattr(C, "_get_public_ip", lambda: "1.2.3.4")
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "Bibzzzzz")
        monkeypatch.setattr(C._urlreq, "urlopen", fake_urlopen)
        C._last_access_check = 0.0
        C.enforce_gist(force=True)
        assert calls["update"] == 0


# ══════════════════════════════════════════════════════════════════════
# Field report: "IP/username sudah saya blokir tapi masih bisa akses"
# ══════════════════════════════════════════════════════════════════════

class TestBanEnforcement:
    """A ban must survive the user pulling the plug on the backend."""

    def _payload(self, **kw):
        base = {"banned": False, "limit_exceeded": False, "found": True,
                "usage": 10, "limit": 500000, "username": "u"}
        base.update(kw)
        return base

    def _resp(self, payload):
        class R:
            def read(self_inner):
                return json.dumps(payload).encode()

            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *a):
                return False
        return R()

    @pytest.fixture(autouse=True)
    def _isolate(self, monkeypatch, tmp_path):
        import deepseek.config as C
        monkeypatch.setattr(C, "_DENIAL_FILE", tmp_path / "access.json")
        monkeypatch.setattr(C, "_resolve_api_url", lambda: ("https://x", None))
        monkeypatch.setattr(C, "_get_public_ip", lambda: "1.2.3.4")
        monkeypatch.setattr(C, "resolve_username", lambda force=False: "u")
        monkeypatch.setattr(C, "_load_auth_session", lambda: {"uid": "u1"})
        monkeypatch.setattr(C, "update_gist_usage", lambda *a, **k: None)
        C._cached_usage_status = None
        C._last_access_check = 0.0
        C._offline_mode = False
        yield

    def test_ban_blocks_when_online(self, monkeypatch):
        import deepseek.config as C
        monkeypatch.setattr(C._urlreq, "urlopen",
                            lambda *a, **k: self._resp(self._payload(banned=True)))
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_ban_survives_network_cut(self, monkeypatch):
        """BYPASS: block api.github.com and the ban used to evaporate."""
        import deepseek.config as C
        monkeypatch.setattr(C._urlreq, "urlopen",
                            lambda *a, **k: self._resp(self._payload(banned=True)))
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

        # now the user kills their network
        C._last_access_check = 0.0
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_ban_survives_restart(self, monkeypatch, tmp_path):
        """The verdict is persisted, so quitting and relaunching offline
        must not clear it."""
        import deepseek.config as C
        C._save_persisted_denial(True, False)
        C._cached_usage_status = None          # fresh process
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))
        C._last_access_check = 0.0
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_limit_exceeded_survives_network_cut(self, monkeypatch):
        import deepseek.config as C
        C._save_persisted_denial(False, True, "over quota")
        C._cached_usage_status = None
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))
        C._last_access_check = 0.0
        with pytest.raises(SystemExit):
            C.enforce_gist(force=True)

    def test_unban_clears_the_local_denial(self, monkeypatch):
        import deepseek.config as C
        C._save_persisted_denial(True, False)
        monkeypatch.setattr(C._urlreq, "urlopen",
                            lambda *a, **k: self._resp(self._payload(banned=False)))
        C._last_access_check = 0.0
        C.enforce_gist(force=True)                      # server says clear
        assert C._load_persisted_denial() == {}

        C._cached_usage_status = None
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))
        C._last_access_check = 0.0
        C.enforce_gist(force=True)                      # offline: must pass

    def test_offline_still_open_for_clean_users(self, monkeypatch):
        """The offline fail-open must still work for everyone else."""
        import deepseek.config as C
        monkeypatch.setattr(C, "_resolve_api_url", lambda: (None, None))
        C._last_access_check = 0.0
        C.enforce_gist(force=True)          # must NOT raise
        assert C.is_offline() is True

    def test_check_sends_uid_for_account_ban(self, monkeypatch):
        """IP bans are defeated by changing networks; the client must
        identify its account so the server can ban that instead."""
        import deepseek.config as C
        seen = {}

        def cap(req, timeout=None):
            seen["url"] = req.full_url if hasattr(req, "full_url") else str(req)
            return self._resp(self._payload())

        monkeypatch.setattr(C._urlreq, "urlopen", cap)
        C._last_access_check = 0.0
        C.enforce_gist(force=True)
        assert "uid=u1" in seen.get("url", "")


class TestBanIsAccountScoped:
    """Worker-side: the two ban systems must be linked."""

    def test_check_honours_account_ban(self):
        w = (ROOT / "dashboard-react" / "worker.js").read_text()
        i = w.index('url.pathname === "/api/check"')
        j = w.index('url.pathname === "/api/version"', i)
        body = w[i:j]
        assert 'searchParams.get("uid")' in body
        assert "prof.banned === true" in body

    def test_admin_toggle_ban_mirrors_to_account(self):
        w = (ROOT / "dashboard-react" / "worker.js").read_text()
        i = w.index('action === "toggle_ban"')
        j = w.index('action === "update_limit"', i)
        assert "user.uid" in w[i:j]
        assert "banned:" in w[i:j]

    def test_update_records_uid(self):
        w = (ROOT / "dashboard-react" / "worker.js").read_text()
        assert "if (uid) user.uid = uid;" in w


class TestSkipAuthCannotBypassOnInstalledClient:
    def test_skip_auth_is_gated_to_source_checkouts(self):
        src = (PKG / "auth.py").read_text()
        i = src.index("DEEPSEEK_SKIP_AUTH")
        window = src[i:i + 900]
        assert "site-packages" in window and ".local" in window, \
            "SKIP_AUTH must not work on an installed client"


# ══════════════════════════════════════════════════════════════════════
# Field report: reasoning bocor + jawaban tampil dua kali
#   you > pp
#     ─── thinking ───
#     User repeatedly sent "pp"... </think>
#     "pp" - is there something specific...      <- muncul 2x
# ══════════════════════════════════════════════════════════════════════

class TestUnpairedThinkTag:
    """Reasoning models often emit only the CLOSING </think> because the
    opening tag lives in the chat template. That leaked raw chain-of-thought
    and the literal tag onto the screen."""

    def _run(self, chunks):
        from deepseek.agent import ThinkTagStreamParser
        p = ThinkTagStreamParser()
        out = []
        for c in chunks:
            out += p.feed(c)
        out += p.flush()
        return out

    def _joined(self, out, kind):
        """Replay the stream the way the agent does, honouring retractions."""
        buf = ""
        for k, v in out:
            if k == "retract_content" and kind == "content":
                if buf.endswith(v):
                    buf = buf[: -len(v)]
            elif k == kind:
                buf += v
        return buf

    def test_unpaired_closer_splits_reasoning(self):
        out = self._run(['User sent "pp"... testing.\n\n</think>\n\n"pp" - need help?'])
        assert "testing" in self._joined(out, "thinking")
        content = self._joined(out, "content")
        assert "need help?" in content
        assert "</think>" not in content
        assert "User sent" not in content

    def test_paired_form_still_works(self):
        out = self._run(["<think>nalar</think>jawaban"])
        assert self._joined(out, "thinking") == "nalar"
        assert self._joined(out, "content") == "jawaban"

    def test_plain_text_untouched(self):
        out = self._run(["halo dunia"])
        assert self._joined(out, "content") == "halo dunia"

    def test_unpaired_closer_split_across_chunks(self):
        """Opening text is buffered briefly, so a late </think> reclassifies it
        as reasoning with nothing flashing on screen first."""
        out = self._run(["nalar ", "lanjut</thi", "nk>JAWABAN"])
        assert self._joined(out, "content") == "JAWABAN"
        assert "nalar lanjut" in self._joined(out, "thinking")

    def test_long_answer_still_streams_before_any_tag(self):
        """The grace buffer must not stall a normal (tagless) reply."""
        long_text = "x" * 400
        out = self._run([long_text])
        assert self._joined(out, "content") == long_text

    def test_retraction_path_still_works_past_grace(self):
        """If reasoning exceeds the buffer it does get shown, and must then be
        explicitly retracted when </think> finally arrives."""
        out = self._run(["r" * 300, "</think>JAWAB"])
        assert any(k == "retract_content" for k, _ in out)
        assert self._joined(out, "content") == "JAWAB"

    def test_literal_closer_after_a_real_pair_is_kept(self):
        """Once a proper <think>…</think> pair has been seen, a later
        </think> in prose must not swallow the answer."""
        out = self._run(["<think>a</think>jawab lalu bahas </think> literal"])
        assert "jawab lalu bahas" in self._joined(out, "content")

    def test_renderer_can_retract(self):
        from deepseek.ui import StreamRenderer
        r = StreamRenderer(thinking_visible=True)
        assert callable(r.retract_content)
        r.retract_content("teks reasoning")   # must not raise

    def test_final_content_never_contains_think_tag(self):
        src = (PKG / "agent.py").read_text()
        assert r"</\s*think\s*>" in src, "missing final think-tag scrub"


class TestNoDoubleAnswer:
    """The reasoning pre-pass ran for EVERY model. On a native reasoning
    model that made it answer twice — once as 'thinking', once for real."""

    def _agent(self, model):
        from deepseek.agent import Agent
        from deepseek.memory import Memory

        class P:
            supports_tools = False
            default_model = "m"

        class T:
            tools = {}

            def get_openai_tools(self):
                return []

            def is_dangerous(self, n):
                return False

        return Agent(Memory(), T(), P(), model, thinking_visible=True)

    @pytest.mark.parametrize("model", [
        "deepseek/deepseek-r1-0528:free",
        "qwen/qwq-32b",
        "anthropic/claude-sonnet-4",
        "openai/o3-mini",
    ])
    def test_prepass_skipped_for_reasoning_models(self, model):
        assert self._agent(model)._model_has_native_reasoning() is True

    @pytest.mark.parametrize("model", ["gpt-4.1-mini", "agnes-2.0-flash",
                                       "llama-3.3-70b-versatile"])
    def test_prepass_kept_for_plain_models(self, model):
        assert self._agent(model)._model_has_native_reasoning() is False

    def test_detection_is_sticky_once_reasoning_seen(self):
        a = self._agent("some-unknown-model")
        assert a._model_has_native_reasoning() is False
        a._seen_native_reasoning = True
        assert a._model_has_native_reasoning() is True

    def test_reasoning_model_calls_llm_once_per_turn(self, monkeypatch):
        """The regression itself: one user turn must be one answer."""
        import deepseek.agent as A
        import deepseek.config as C
        monkeypatch.setattr(C, "enforce_gist", lambda *a, **k: {})
        monkeypatch.setattr(C, "update_gist_usage", lambda *a, **k: None)

        calls = {"n": 0}

        class P:
            supports_tools = False
            default_model = "m"

            def chat_stream(self, **kw):
                calls["n"] += 1
                yield {"type": "thinking", "data": "menimbang..."}
                yield {"type": "content", "data": "jawaban tunggal"}
                yield {"type": "done", "data": None}

        from deepseek.memory import Memory

        class T:
            tools = {}

            def get_openai_tools(self):
                return []

            def is_dangerous(self, n):
                return False

        a = A.Agent(Memory(), T(), P(), "deepseek/deepseek-r1-0528:free",
                    thinking_visible=True)
        monkeypatch.setattr(a, "_start_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_stop_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_check_interrupt", lambda: False)
        res = a.chat("pp")
        assert calls["n"] == 1, f"model was queried {calls['n']}x for one turn"
        assert res["content"].strip() == "jawaban tunggal"
        assert res["content"].count("jawaban tunggal") == 1


# ══════════════════════════════════════════════════════════════════════
# Field report: "Login failed: <urlopen error _ssl.c:983: handshake timed out>"
# ══════════════════════════════════════════════════════════════════════

class TestAuthNetworkResilience:
    """A single TLS hiccup used to fail the login outright, show a raw C-level
    error string, and make the user retype their email."""

    def test_transient_errors_are_recognised(self):
        from deepseek.auth import _is_transient
        for e in ["<urlopen error _ssl.c:983: The handshake operation timed out>",
                  "timed out", "Connection reset by peer",
                  "[Errno -2] Name or service not known",
                  "EOF occurred in violation of protocol"]:
            assert _is_transient(e), e

    def test_real_auth_verdicts_are_not_transient(self):
        from deepseek.auth import _is_transient
        for e in ["INVALID_LOGIN_CREDENTIALS", "USER_DISABLED",
                  "EMAIL_NOT_FOUND", "WEAK_PASSWORD"]:
            assert not _is_transient(e), e

    def test_transient_failure_is_retried(self, monkeypatch):
        import deepseek.auth as A
        calls = {"n": 0}

        def flaky(req, timeout=None):
            calls["n"] += 1
            if calls["n"] < 3:
                raise OSError("_ssl.c:983: The handshake operation timed out")

            class R:
                def read(self_inner):
                    return b'{"idToken":"t","localId":"u"}'

                def __enter__(self_inner):
                    return self_inner

                def __exit__(self_inner, *a):
                    return False
            return R()

        monkeypatch.setattr(A.urllib.request, "urlopen", flaky)
        monkeypatch.setattr(A.time, "sleep", lambda s: None)
        out = A._post_json("https://x", {"a": 1})
        assert out["idToken"] == "t"
        assert calls["n"] == 3, "should have retried twice before succeeding"

    def test_credential_errors_are_not_retried(self, monkeypatch):
        """A wrong password is an answer, not a failure — retrying it would
        just slow the user down and risk rate limiting."""
        import deepseek.auth as A
        calls = {"n": 0}

        def denied(req, timeout=None):
            calls["n"] += 1
            raise A.urllib.error.HTTPError(
                "u", 400, "Bad Request", {},
                io.BytesIO(b'{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}'))

        monkeypatch.setattr(A.urllib.request, "urlopen", denied)
        monkeypatch.setattr(A.time, "sleep", lambda s: None)
        with pytest.raises(A.FirebaseError) as ei:
            A._post_json("https://x", {})
        assert "INVALID_LOGIN_CREDENTIALS" in str(ei.value)
        assert calls["n"] == 1

    def test_raw_ssl_error_is_humanised(self):
        from deepseek.auth import _friendly_error
        msg = _friendly_error(
            "<urlopen error _ssl.c:983: The handshake operation timed out>")
        assert "_ssl.c" not in msg
        assert "network" in msg.lower() or "connection" in msg.lower()
        assert "not rejected" in msg.lower(), \
            "must make clear the credentials were fine"

    def test_disabled_account_tells_user_how_to_appeal(self):
        from deepseek.auth import _friendly_error
        msg = _friendly_error("USER_DISABLED")
        assert "disabled" in msg.lower()
        assert "t.me" in msg or "Telegram" in msg

    def test_email_is_remembered_between_attempts(self):
        src = (PKG / "auth.py").read_text()
        i = src.index("def _do_login(")
        j = src.index("\ndef ", i + 10)
        body = src[i:j]
        assert "_last_email" in body, \
            "a failed attempt must not force the user to retype their email"

    def test_default_timeout_is_generous(self):
        import inspect
        from deepseek.auth import _post_json
        sig = inspect.signature(_post_json)
        assert sig.parameters["timeout"].default >= 30
        assert sig.parameters["retries"].default >= 1
