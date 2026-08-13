"""Isolated built-in tool runner used for untrusted document/media parsing.

This module is not a policy entrypoint. The parent Agent validates, authorizes,
and obtains user approval before launching it. Isolation gives the parent a
process it can terminate on CPU/memory/parser hangs.
"""

from __future__ import annotations

import json
import os
import sys


def _apply_resource_limits() -> None:
    """Best-effort Unix limits for untrusted parsers."""
    try:
        import resource
        memory = max(256, int(os.environ.get('DEEPSEEK_PARSER_MAX_MEMORY_MB', '1024'))) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_FSIZE, (100 * 1024 * 1024, 100 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        resource.setrlimit(resource.RLIMIT_CPU, (125, 130))
    except (ImportError, OSError, ValueError):
        pass


def main() -> int:
    try:
        _apply_resource_limits()
        raw = sys.stdin.buffer.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("isolated tool request is too large")
        request = json.loads(raw.decode("utf-8"))
        name = request.get("tool")
        arguments = request.get("arguments")
        if not isinstance(name, str) or not isinstance(arguments, dict):
            raise ValueError("invalid isolated tool request")

        from .toolkit import PROCESS_ISOLATED_TOOLS, ToolRegistry

        if name not in PROCESS_ISOLATED_TOOLS:
            raise ValueError(f"tool is not process-isolated: {name}")
        registry = ToolRegistry()
        tool = registry.tools.get(name)
        if not tool:
            raise ValueError(f"unknown tool: {name}")
        result = tool["handler"](arguments)
        payload = {"ok": True, "result": str(result if result is not None else "")}
    except BaseException as exc:  # child boundary: serialize every failure
        payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    encoded = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    sys.stdout.buffer.write(encoded[:2_000_000])
    sys.stdout.buffer.flush()
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
