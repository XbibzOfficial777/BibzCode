#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: retry.sh command [args...]" >&2
  exit 64
fi

max_attempts="${BIBZCODE_RETRY_ATTEMPTS:-3}"
for attempt in $(seq 1 "$max_attempts"); do
  echo "[ci-retry] attempt ${attempt}/${max_attempts}: $*"
  if "$@"; then
    exit 0
  fi
  if [[ "$attempt" -lt "$max_attempts" ]]; then
    echo "[ci-retry] transient failure; clearing only generated caches before retry" >&2
    npm cache verify >/dev/null 2>&1 || true
    sleep $((attempt * 10))
  fi
done

echo "[ci-retry] command failed after ${max_attempts} attempts" >&2
exit 1
