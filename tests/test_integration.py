"""
Deeper behavioural / integration tests for DeepSeek CLI v7.8.

These drive real code paths end-to-end (agent loop, tool execution, memory
round-trips, provider streaming) with fakes standing in only for the network.

Run:  python -m pytest tests/ -v
"""

import io
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DEEPSEEK_SKIP_AUTH", "1")


# ══════════════════════════════════════════════════════════════════════
# Fakes
# ══════════════════════════════════════════════════════════════════════

class ScriptedProvider:
    """Provider that replays a scripted list of chunk-lists, one per round."""

    supports_tools = True
    default_model = "fake-model"

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def chat_stream(self, messages=None, model=None, tools=None, **kw):
        self.calls.append({"messages": messages, "tools": tools})
        chunks = self.script.pop(0) if self.script else [
            {"type": "content", "data": "done"}, {"type": "done", "data": None}]
        for c in chunks:
            yield c


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Neutralise all backend chatter so tests stay hermetic."""
    import deepseek.config as C
    monkeypatch.setattr(C, "enforce_gist", lambda *a, **k: {})
    monkeypatch.setattr(C, "update_gist_usage", lambda *a, **k: None)
    monkeypatch.setattr(C, "resolve_username", lambda force=False: "tester")
    yield


@pytest.fixture
def agent_factory(monkeypatch):
    from deepseek.agent import Agent
    from deepseek.memory import Memory
    from deepseek.toolkit import ToolRegistry

    def make(script, thinking=False):
        prov = ScriptedProvider(script)
        reg = ToolRegistry()
        a = Agent(Memory(), reg, prov, "fake-model", thinking_visible=thinking)
        monkeypatch.setattr(a, "_start_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_stop_interrupt_monitor", lambda: None)
        monkeypatch.setattr(a, "_check_interrupt", lambda: False)
        return a, prov, reg

    return make


# ══════════════════════════════════════════════════════════════════════
# Agent loop
# ══════════════════════════════════════════════════════════════════════

class TestAgentLoop:

    def test_plain_answer(self, agent_factory):
        a, _, _ = agent_factory([[
            {"type": "content", "data": "Hello "},
            {"type": "content", "data": "world"},
            {"type": "done", "data": None},
        ]])
        res = a.chat("hi")
        assert res["content"].strip() == "Hello world"
        assert res["stopped_by"] == "natural"
        assert res["tool_rounds"] == 0

    def test_tool_round_then_answer(self, agent_factory, tmp_path):
        target = tmp_path / "note.txt"
        target.write_text("secret-content")
        a, _, _ = agent_factory([
            [{"type": "tool_calls", "data": [{
                "id": "c1", "type": "function",
                "function": {"name": "read_file",
                             "arguments": json.dumps({"path": str(target)})}}]},
             {"type": "done", "data": None}],
            [{"type": "content", "data": "The file says secret-content"},
             {"type": "done", "data": None}],
        ])
        res = a.chat("read it")
        assert res["tool_rounds"] == 1
        assert "secret-content" in res["content"]
        roles = [m["role"] for m in a.memory.messages]
        assert "tool" in roles, "tool result must be fed back to the model"

    def test_reasoning_only_response_is_surfaced(self, agent_factory):
        a, _, _ = agent_factory([[
            {"type": "thinking", "data": "I think the answer is 42."},
            {"type": "done", "data": None},
        ]])
        res = a.chat("q")
        assert "42" in res["content"]

    def test_empty_response_is_explained(self, agent_factory):
        a, _, _ = agent_factory([[{"type": "done", "data": None}]])
        res = a.chat("q")
        assert "No response" in res["content"]

    def test_stream_error_is_reported(self, agent_factory):
        a, _, _ = agent_factory([[
            {"type": "error", "data": "API Error 401: bad key"},
        ]])
        res = a.chat("q")
        assert res["stopped_by"] == "stream_error"

    def test_unknown_tool_does_not_crash(self, agent_factory):
        a, _, _ = agent_factory([
            [{"type": "tool_calls", "data": [{
                "id": "c1", "type": "function",
                "function": {"name": "no_such_tool", "arguments": "{}"}}]},
             {"type": "done", "data": None}],
            [{"type": "content", "data": "recovered"},
             {"type": "done", "data": None}],
        ])
        res = a.chat("go")
        assert "recovered" in res["content"]
        tool_msgs = [m for m in a.memory.messages if m["role"] == "tool"]
        assert any("Unknown tool" in m["content"] for m in tool_msgs)

    def test_malformed_tool_json_recovers(self, agent_factory):
        a, _, _ = agent_factory([
            [{"type": "tool_calls", "data": [{
                "id": "c1", "type": "function",
                "function": {"name": "calculate", "arguments": "{not json"}}]},
             {"type": "done", "data": None}],
            [{"type": "content", "data": "ok"}, {"type": "done", "data": None}],
        ])
        res = a.chat("calc")
        assert res["content"].strip() == "ok"

    def test_anti_stuck_breaks_repetition(self, agent_factory):
        call = [{"type": "tool_calls", "data": [{
            "id": "c", "type": "function",
            "function": {"name": "calculate",
                         "arguments": json.dumps({"expression": "1+1"})}}]},
            {"type": "done", "data": None}]
        a, _, _ = agent_factory([list(call) for _ in range(12)])
        res = a.chat("loop")
        assert res["stopped_by"] == "anti_stuck"
        assert "Anti-stuck" in (res["error"] or "")

    def test_dangerous_tool_rejected_without_tty(self, agent_factory, tmp_path, monkeypatch):
        monkeypatch.setattr(sys, "stdin", io.StringIO())
        victim = tmp_path / "keep.txt"
        victim.write_text("data")
        a, _, _ = agent_factory([
            [{"type": "tool_calls", "data": [{
                "id": "c1", "type": "function",
                "function": {"name": "delete_file",
                             "arguments": json.dumps({"path": str(victim)})}}]},
             {"type": "done", "data": None}],
            [{"type": "content", "data": "could not delete"},
             {"type": "done", "data": None}],
        ])
        a.chat("delete it")
        assert victim.exists(), "file deleted without confirmation!"


# ══════════════════════════════════════════════════════════════════════
# Tool layer
# ══════════════════════════════════════════════════════════════════════

class TestToolLayer:

    @pytest.fixture(scope="class")
    def reg(self):
        from deepseek.toolkit import ToolRegistry
        return ToolRegistry()

    def test_expected_tool_count(self, reg):
        assert len(reg.tools) >= 88

    def test_every_tool_has_valid_schema(self, reg):
        for name, t in reg.tools.items():
            p = t["parameters"]
            assert isinstance(p, dict), name
            assert p.get("type") == "object", name
            assert isinstance(p.get("properties", {}), dict), name
            for req in p.get("required", []):
                assert req in p["properties"], f"{name}: required '{req}' not declared"

    def test_openai_schema_export(self, reg):
        for spec in reg.get_openai_tools():
            assert spec["type"] == "function"
            assert spec["function"]["name"]
            assert isinstance(spec["function"]["description"], str)

    def test_file_roundtrip(self, reg, tmp_path):
        p = tmp_path / "a.txt"
        reg.execute("write_file", {"path": str(p), "content": "one\ntwo\n"}, confirm=False)
        assert p.read_text() == "one\ntwo\n"
        out = reg.execute("read_file", {"path": str(p)}, confirm=False)
        assert "one" in out and "two" in out
        reg.execute("edit_file", {"path": str(p), "old_string": "one",
                                  "new_string": "ONE"}, confirm=False)
        assert "ONE" in p.read_text()

    def test_read_missing_file_is_graceful(self, reg):
        out = reg.execute("read_file", {"path": "/nonexistent/x"}, confirm=False)
        assert "not found" in out.lower()

    def test_run_code_timeout_default_applies(self, reg):
        """Regression for the None-timeout bug: an omitted timeout must fall
        back to the handler default, not disable the limit."""
        out = reg.execute("run_code", {"code": "print(6*7)"}, confirm=False)
        assert "42" in out

    def test_run_shell_works(self, reg):
        out = reg.execute("run_shell", {"command": "echo integration"}, confirm=False)
        assert "integration" in out

    def test_json_and_text_utilities(self, reg):
        out = reg.execute("json_parse", {"json_string": '{"a": 1}'}, confirm=False)
        assert "a" in out
        out = reg.execute("text_transform", {"text": "abc", "operation": "upper"},
                          confirm=False)
        assert "ABC" in out

    def test_base64_roundtrip(self, reg):
        enc = reg.execute("base64_tool", {"data": "hello", "mode": "encode"},
                          confirm=False).strip()
        token = enc.split()[-1]
        dec = reg.execute("base64_tool", {"data": token, "mode": "decode"},
                          confirm=False)
        assert "hello" in dec


# ══════════════════════════════════════════════════════════════════════
# Memory
# ══════════════════════════════════════════════════════════════════════

class TestMemory:

    def test_session_roundtrip(self, tmp_path, monkeypatch):
        import deepseek.memory as M
        monkeypatch.setattr(M, "SESSIONS_DIR", str(tmp_path))
        mem = M.Memory()
        mem.add_user("hello")
        mem.add_assistant("hi there")
        mem.session_name = "my session"
        M.save_session("dscli-test01", mem)
        loaded = M.load_session("dscli-test01")
        assert loaded is not None
        assert loaded.session_name == "my session"
        assert [m["content"] for m in loaded.messages if m["role"] == "user"] == ["hello"]

    def test_base_prompt_not_mistaken_for_custom(self):
        from deepseek.memory import Memory
        m1 = Memory()
        rendered = m1.system_prompt
        m2 = Memory()
        m2.system_prompt = rendered
        assert m2._is_completely_custom is False
        assert m2._custom_addition == ""

    def test_custom_prompt_survives(self):
        from deepseek.memory import Memory
        m = Memory()
        m.system_prompt = "You are a pirate."
        assert m._is_completely_custom is True
        assert "pirate" in m.system_prompt

    def test_list_and_delete(self, tmp_path, monkeypatch):
        import deepseek.memory as M
        monkeypatch.setattr(M, "SESSIONS_DIR", str(tmp_path))
        mem = M.Memory()
        mem.add_user("x")
        M.save_session("dscli-aaa", mem)
        assert any(s["session_id"] == "dscli-aaa" for s in M.list_sessions())
        assert M.delete_session("dscli-aaa") is True
        assert M.delete_session("dscli-aaa") is False

    def test_corrupt_session_returns_none(self, tmp_path, monkeypatch):
        import deepseek.memory as M
        monkeypatch.setattr(M, "SESSIONS_DIR", str(tmp_path))
        (tmp_path / "dscli-bad.json").write_text("{ broken")
        assert M.load_session("dscli-bad") is None


# ══════════════════════════════════════════════════════════════════════
# Providers
# ══════════════════════════════════════════════════════════════════════

class TestProviders:

    def test_factory_types(self):
        from deepseek.providers import (create_provider, GeminiProvider,
                                        AnthropicProvider, HuggingFaceProvider,
                                        OpenAICompatibleProvider)
        cases = {
            "gemini": GeminiProvider, "anthropic": AnthropicProvider,
            "huggingface": HuggingFaceProvider, "openai_compatible": OpenAICompatibleProvider,
        }
        for ptype, cls in cases.items():
            p = create_provider("x", {"type": ptype, "base_url": "u"}, "k")
            assert isinstance(p, cls)

    def test_gemini_tools_single_declaration_object(self):
        from deepseek.providers import GeminiProvider
        p = GeminiProvider("gemini", {"base_url": "u"}, "k")
        tools = [
            {"type": "function", "function": {"name": "a", "description": "d",
                                              "parameters": {"type": "object", "properties": {}}}},
            {"type": "function", "function": {"name": "b", "description": "d",
                                              "parameters": {"type": "object", "properties": {}}}},
        ]
        out = p._convert_tools(tools)
        assert len(out) == 1
        assert len(out[0]["functionDeclarations"]) == 2

    def test_anthropic_message_conversion(self):
        from deepseek.providers import AnthropicProvider
        p = AnthropicProvider("anthropic", {"base_url": "u"}, "k")
        sys_txt, msgs = p._convert_messages([
            {"role": "system", "content": "be nice"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "t1", "function": {"name": "f", "arguments": '{"x":1}'}}]},
            {"role": "tool", "tool_call_id": "t1", "name": "f", "content": "res"},
        ])
        assert sys_txt == "be nice"
        assert msgs[0]["role"] == "user"
        assert any(
            isinstance(m["content"], list)
            and any(b.get("type") == "tool_use" for b in m["content"])
            for m in msgs)

    def test_openai_sanitizes_bad_tool_args(self):
        from deepseek.providers import OpenAICompatibleProvider
        s = OpenAICompatibleProvider._sanitize_json
        assert json.loads(s("{'a': 1}")) == {"a": 1}
        assert json.loads(s('{"a": None}')) == {"a": None}
        assert json.loads(s("garbage")) == {}
        # must not corrupt already-valid JSON containing apostrophes
        ok = '{"msg": "it\'s fine"}'
        assert json.loads(s(ok))["msg"] == "it's fine"

    def test_huggingface_tool_prompt_roundtrip(self):
        from deepseek.providers import HuggingFaceProvider
        p = HuggingFaceProvider("hf", {"base_url": "u"}, "k")
        text = 'sure [TOOL_CALL]{"name": "read_file", "arguments": {"path": "/x"}}[/TOOL_CALL]'
        clean, calls = p._parse_tool_calls(text)
        assert len(calls) == 1
        assert calls[0]["function"]["name"] == "read_file"
        assert "TOOL_CALL" not in clean


# ══════════════════════════════════════════════════════════════════════
# Streaming think-tag parser
# ══════════════════════════════════════════════════════════════════════

class TestThinkTagParser:

    def test_split_across_chunks(self):
        from deepseek.agent import ThinkTagStreamParser
        p = ThinkTagStreamParser()
        out = []
        for chunk in ["Hello <thi", "nk>secret", " reasoning</th", "ink> visible"]:
            out.extend(p.feed(chunk))
        out.extend(p.flush())
        thinking = "".join(t for k, t in out if k == "thinking")
        content = "".join(t for k, t in out if k == "content")
        assert "secret reasoning" in thinking
        assert "<think>" not in content and "</think>" not in content
        assert "visible" in content

    def test_plain_text_passthrough(self):
        from deepseek.agent import ThinkTagStreamParser
        p = ThinkTagStreamParser()
        out = p.feed("just text") + p.flush()
        assert "".join(t for k, t in out if k == "content") == "just text"


# ══════════════════════════════════════════════════════════════════════
# JSON helpers
# ══════════════════════════════════════════════════════════════════════

class TestJsonHelpers:

    def test_safe_parse_json_recovers(self):
        from deepseek.agent import safe_parse_json
        assert safe_parse_json('{"a": 1}') == {"a": 1}
        assert safe_parse_json('{"a": 1') == {"a": 1}

    def test_safe_parse_json_raises_on_garbage(self):
        from deepseek.agent import safe_parse_json
        with pytest.raises(ValueError):
            safe_parse_json("total nonsense")

    def test_sanitize_preserves_valid_input(self):
        from deepseek.agent import sanitize_json_args
        src = '{"content": "don\'t break this"}'
        assert json.loads(sanitize_json_args(src))["content"] == "don't break this"


# ══════════════════════════════════════════════════════════════════════
# safe_execute
# ══════════════════════════════════════════════════════════════════════

class TestSafeExecute:

    def test_returns_value(self):
        from deepseek.agent import safe_execute
        assert safe_execute(lambda a: "ok", {}, tool_name="t") == "ok"

    def test_permanent_error_not_retried(self):
        from deepseek.agent import safe_execute
        calls = {"n": 0}

        def boom(a):
            calls["n"] += 1
            raise ValueError("bad argument")

        out = safe_execute(boom, {}, tool_name="t", retries=2)
        assert "[ERROR]" in out
        assert calls["n"] == 1, "permanent errors must not be retried"

    def test_transient_error_retried(self):
        from deepseek.agent import safe_execute
        calls = {"n": 0}

        def flaky(a):
            calls["n"] += 1
            if calls["n"] < 2:
                raise OSError("connection reset")
            return "recovered"

        assert safe_execute(flaky, {}, tool_name="t", retries=2) == "recovered"
        assert calls["n"] == 2

    def test_timeout_enforced_when_requested(self):
        import time
        from deepseek.agent import safe_execute
        out = safe_execute(lambda a: time.sleep(5), {}, timeout=1, tool_name="slow")
        assert "[ERROR]" in out and "exceed" in out.lower()


# ══════════════════════════════════════════════════════════════════════
# Multi-agent
# ══════════════════════════════════════════════════════════════════════

class TestMultiAgent:

    def test_profiles_are_well_formed(self):
        from deepseek.multi_agent import AGENT_PROFILES
        for pid, prof in AGENT_PROFILES.items():
            assert "name" in prof and "description" in prof
            assert isinstance(prof.get("system_prompt_extra", ""), str)

    def test_worker_uses_gated_execute(self):
        """Sub-agents must go through ToolRegistry.execute() so they inherit
        validation and the confirmation gate."""
        src = (ROOT / "deepseek" / "multi_agent.py").read_text()
        assert "self.tools.execute(" in src
        assert "['handler']" not in src
