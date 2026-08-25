#!/usr/bin/env python3
"""Fail-closed secret pattern scan for tracked text files.

The scanner intentionally reports only file, line, and rule. It never prints
matched source text or secret values into CI logs.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private-key-block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("openai-key", re.compile(r"\bsk-(?:proj-|live-|admin-)?[A-Za-z0-9_-]{20,}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("discord-token", re.compile(r"\b[MN][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
)
ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passphrase|private[_-]?key|secret)\b"
    r"\s*[:=]\s*[\"']([^\"']{12,})[\"']"
)
PLACEHOLDER = re.compile(r"(?i)^(?:change[-_ ]?me|example|sample|dummy|placeholder|your[-_ ]|<[^>]+>|\$\{|os\.environ|getenv\(|none|null|true|false)$")
PUBLIC_KEY_PREFIXES = ("AIza",)
IGNORED_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".pdf", ".zip", ".gz", ".tar", ".vsix", ".exe", ".dmg", ".appimage"}


def tracked_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files", "-z"], check=True, stdout=subprocess.PIPE)
    return [Path(value) for value in result.stdout.decode("utf-8", "surrogateescape").split("\0") if value]


def likely_assignment_secret(match: re.Match[str], line: str) -> bool:
    value = match.group(2).strip()
    if value.startswith(PUBLIC_KEY_PREFIXES) or PLACEHOLDER.fullmatch(value):
        return False
    prefix = line[: match.start(2)].lower()
    if "environ" in prefix or "getenv" in prefix or "process.env" in prefix:
        return False
    if value.startswith(("http://", "https://")) or value.startswith("/dev/"):
        return False
    return True


def main() -> int:
    findings: list[tuple[str, int, str]] = []
    for file_path in tracked_files():
        if file_path.suffix.lower() in IGNORED_SUFFIXES or not file_path.is_file():
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            for rule, pattern in RULES:
                if pattern.search(line):
                    findings.append((str(file_path), line_number, rule))
            for match in ASSIGNMENT.finditer(line):
                if likely_assignment_secret(match, line):
                    findings.append((str(file_path), line_number, "literal-secret-assignment"))
    unique = sorted(set(findings))
    for file_path, line_number, rule in unique:
        print(f"{file_path}:{line_number}: {rule}")
    if unique:
        print(f"Secret scan failed: {len(unique)} potential finding(s); values are intentionally omitted.", file=sys.stderr)
        return 1
    print("Secret scan passed: no high-confidence hardcoded secret patterns found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
