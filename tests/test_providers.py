import httpx

from bibzcode.providers import GeminiProvider, OpenAICompatibleProvider


class FailingClient:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        raise httpx.ConnectError("offline")
    def __exit__(self, *args):
        return False


def test_openai_connect_error_has_terminal_done(monkeypatch):
    provider = OpenAICompatibleProvider(
        "test", {"base_url": "https://example.invalid", "default_model": "m", "supports_tools": True}, "key"
    )
    monkeypatch.setattr(httpx, "Client", FailingClient)
    chunks = list(provider.chat_stream([{"role": "user", "content": "hi"}]))
    assert chunks[0]["type"] == "error"
    assert chunks[-1]["type"] == "done"


def test_gemini_keeps_duplicate_same_name_calls(monkeypatch):
    # Verify the implementation is index-based, not name-keyed, via a minimal
    # synthetic stream response.
    events = [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"x","args":{"a":1}}},{"functionCall":{"name":"x","args":{"a":2}}}]},"finishReason":"STOP"}]}',
    ]

    class Response:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def iter_lines(self): return iter(events)

    class Client:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def stream(self, *args, **kwargs): return Response()

    monkeypatch.setattr(httpx, "Client", Client)
    provider = GeminiProvider("gemini", {"base_url": "https://example.invalid", "default_model": "m", "supports_tools": True}, "key")
    chunks = list(provider.chat_stream([{"role": "user", "content": "hi"}]))
    calls = next(chunk["data"] for chunk in chunks if chunk["type"] == "tool_calls")
    assert len(calls) == 2
    assert [call["function"]["arguments"] for call in calls] == ['{"a": 1}', '{"a": 2}']
