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
