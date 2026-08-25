#!/usr/bin/env python3
"""Convert Bandit JSON to SARIF without printing source snippets or secrets."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fail-on-findings", action="store_true")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    raw_results = payload.get("results", []) if isinstance(payload, dict) else []
    results: list[dict[str, object]] = []
    rules: dict[str, dict[str, object]] = {}
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        rule_id = str(item.get("test_id", "bandit-unknown"))
        severity = str(item.get("issue_severity", "LOW")).upper()
        level = "error" if severity == "HIGH" else "warning" if severity == "MEDIUM" else "note"
        rules.setdefault(rule_id, {"id": rule_id, "name": str(item.get("test_name", rule_id)), "shortDescription": {"text": str(item.get("issue_text", "Bandit finding"))}})
        filename = str(item.get("filename", "")).replace("\\", "/")
        start_line = max(1, int(item.get("line_number", 1)))
        end_line = max(start_line, int((item.get("line_range") or [start_line])[-1]))
        results.append({
            "ruleId": rule_id,
            "level": level,
            "message": {"text": str(item.get("issue_text", "Bandit finding"))[:1000]},
            "locations": [{"physicalLocation": {"artifactLocation": {"uri": filename}, "region": {"startLine": start_line, "endLine": end_line}}}],
            "properties": {"confidence": str(item.get("issue_confidence", "UNKNOWN")), "severity": severity},
        })
    sarif = {"$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0", "runs": [{"tool": {"driver": {"name": "Bandit", "informationUri": "https://bandit.readthedocs.io/", "rules": list(rules.values())}}, "results": results}]}
    args.output.write_text(json.dumps(sarif, indent=2) + "\n", encoding="utf-8")
    if args.fail_on_findings and results:
        print(f"Bandit security scan found {len(results)} finding(s); SARIF was written without source snippets.")
        return 1
    print(f"Bandit SARIF written with {len(results)} finding(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
