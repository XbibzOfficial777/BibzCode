"""Narrow JSON bridge used by the BibzCode desktop extension.

The bridge never prints API keys and accepts only allowlisted provider/session actions.
It is intentionally separate from the interactive agent so provider and session GUI
operations do not need shell parsing or renderer access to local files.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from .config import DEFAULT_PROVIDERS, ConfigManager
from .memory import delete_session, list_sessions, load_session, save_session
from .providers import create_provider

_MAX_NAME = 120


def emit(value: dict, *, code: int = 0) -> int:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return code


def provider_id(value: str) -> str:
    if value not in DEFAULT_PROVIDERS:
        raise argparse.ArgumentTypeError(f"unknown provider: {value}")
    return value


def providers_command(config: ConfigManager) -> dict:
    rows = []
    for pid, definition in DEFAULT_PROVIDERS.items():
        rows.append({
            "id": pid,
            "name": definition.get("name", pid),
            "active": pid == config.active_provider,
            "model": config.get_provider_model(pid),
            "hasKey": bool(config.get_api_key(pid)),
            "getKeyUrl": definition.get("get_key_url", ""),
        })
    return {"providers": rows}


def models_command(config: ConfigManager, pid: str, live: bool) -> dict:
    definition = config.get_provider_config(pid)
    if not live:
        return {"provider": pid, "models": list(definition.get("popular_models", [])), "live": False}
    key = config.get_api_key(pid)
    if not key:
        raise ValueError(f"no API key configured for {pid}")
    provider = create_provider(pid, definition, key)
    result = provider.fetch_models() or []
    models = []
    for entry in result:
        if isinstance(entry, str):
            models.append(entry)
        elif isinstance(entry, dict) and entry.get("id"):
            models.append(str(entry["id"]))
    return {"provider": pid, "models": models[:5000], "live": True}


def validate_command(config: ConfigManager, pid: str) -> dict:
    definition = config.get_provider_config(pid)
    key = config.get_api_key(pid)
    if not key:
        return {"ok": False, "message": f"No API key configured for {definition.get('name', pid)}"}
    provider = create_provider(pid, definition, key)
    ok, message = provider.validate_key()
    return {"ok": bool(ok), "message": str(message)[:1000]}


def rename_session_command(session_id: str, name: str) -> dict:
    memory = load_session(session_id)
    if memory is None:
        raise ValueError("session not found")
    cleaned = name.strip()[:_MAX_NAME]
    if not cleaned:
        raise ValueError("session name is empty")
    memory.session_name = cleaned
    memory._session_named = True
    save_session(session_id, memory)
    return {"ok": True, "sessionId": session_id, "name": cleaned}


def export_session_command(session_id: str, destination: str) -> dict:
    memory = load_session(session_id)
    if memory is None:
        raise ValueError("session not found")
    if not destination or "\x00" in destination:
        raise ValueError("invalid export path")
    target = Path(destination).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    suffix = target.suffix.lower()
    if suffix == ".html":
        content = memory.export_html()
    elif suffix in {".md", ".markdown"}:
        content = memory.export_markdown()
    elif suffix == ".json":
        content = json.dumps({
            "session_id": session_id,
            "session_name": memory.session_name,
            "conversation_summary": memory.conversation_summary,
            "archived_messages": memory.archived_messages,
            "messages": memory.messages,
            "todo_items": memory.todo_items,
        }, ensure_ascii=False, indent=2)
    else:
        content = memory.export_text()
    temporary = target.with_name(f".{target.name}.bibzcode-tmp")
    temporary.write_text(content, encoding="utf-8")
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    os.replace(temporary, target)
    return {"ok": True, "sessionId": session_id, "path": str(target)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m bibzcode.ide_bridge")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("providers")
    models = sub.add_parser("models")
    models.add_argument("--provider", required=True, type=provider_id)
    models.add_argument("--live", action="store_true")
    validate = sub.add_parser("validate")
    validate.add_argument("--provider", required=True, type=provider_id)
    sub.add_parser("sessions")
    delete = sub.add_parser("delete-session")
    delete.add_argument("session_id")
    rename = sub.add_parser("rename-session")
    rename.add_argument("session_id")
    rename.add_argument("name")
    export = sub.add_parser("export-session")
    export.add_argument("session_id")
    export.add_argument("destination")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = ConfigManager()
    try:
        if args.command == "providers":
            result = providers_command(config)
        elif args.command == "models":
            result = models_command(config, args.provider, args.live)
        elif args.command == "validate":
            result = validate_command(config, args.provider)
        elif args.command == "sessions":
            result = {"sessions": list_sessions()}
        elif args.command == "delete-session":
            result = {"ok": delete_session(args.session_id), "sessionId": args.session_id}
        elif args.command == "rename-session":
            result = rename_session_command(args.session_id, args.name)
        elif args.command == "export-session":
            result = export_session_command(args.session_id, args.destination)
        else:  # pragma: no cover - argparse prevents this
            raise ValueError("unsupported command")
        return emit(result)
    except Exception as exc:
        return emit({"ok": False, "error": str(exc)[:1000]}, code=1)


if __name__ == "__main__":
    raise SystemExit(main())
