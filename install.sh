#!/usr/bin/env bash
# DeepSeek CLI 7.8.0-r6 secure installer.
set -Eeuo pipefail
umask 077

VERSION="7.8.0-r6"
RELEASE_ID="7.8.0-r6"
EXPECTED_SHA256="2636deb695ac6881a218fbb2aab7891db1e71cee7ad723b83f0a4dc53970a8fe"
CF_BASE="${DEEPSEEK_CF_BASE_URL:-https://deepseek-dash.bibzflow.workers.dev}"
CF_ARCHIVE="$CF_BASE/releases/deepseek-cli-$RELEASE_ID.tar.gz"
GH_ARCHIVE="${DEEPSEEK_GITHUB_RELEASE_URL:-https://raw.githubusercontent.com/XbibzOfficial777/deepseek-cli/nightly/releases/deepseek-cli-$RELEASE_ID.tar.gz}"
INSTALL_DIR="${DEEPSEEK_INSTALL_DIR:-$HOME/.local/lib/deepseek-cli}"
VENV_DIR="${DEEPSEEK_VENV_DIR:-$HOME/.deepseek-cli/venv}"
BIN_DIR="${DEEPSEEK_BIN_DIR:-$HOME/.local/bin}"
FULL=false
ACTION=install
YES=false

bold='\033[1m'; green='\033[32m'; yellow='\033[33m'; red='\033[31m'; reset='\033[0m'
info(){ printf '› %s\n' "$*"; }
ok(){ printf "%b✓%b %s\n" "$green$bold" "$reset" "$*"; }
warn(){ printf "%b!%b %s\n" "$yellow$bold" "$reset" "$*"; }
die(){ printf "%b✗ %s%b\n" "$red$bold" "$*" "$reset" >&2; exit 1; }

usage(){ cat <<EOF
DeepSeek CLI $VERSION installer
Usage: bash install.sh [--full] [--uninstall|--purge] [--yes]
  --full       install optional browser/document dependencies
  --uninstall  remove application and launcher; preserve ~/.deepseek-cli
  --purge      remove application plus all local auth/config/sessions (destructive)
  --yes        confirm --purge non-interactively
Environment: DEEPSEEK_CF_BASE_URL, DEEPSEEK_INSTALL_DIR,
             DEEPSEEK_VENV_DIR, DEEPSEEK_BIN_DIR,
             DEEPSEEK_SOURCE_ORDER=cf,github
EOF
}

for arg in "$@"; do
  case "$arg" in
    --full) FULL=true ;;
    --uninstall) ACTION=uninstall ;;
    --purge) ACTION=purge ;;
    --yes|-y) YES=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

remove_application(){
  rm -rf -- "$INSTALL_DIR"
  rm -f -- "$BIN_DIR/dscli"
}

if [[ "$ACTION" == uninstall ]]; then
  remove_application
  ok "Application removed; config, auth, sessions, uploads, logs, and venv preserved in ~/.deepseek-cli"
  exit 0
fi

if [[ "$ACTION" == purge ]]; then
  if [[ "$YES" != true ]]; then
    [[ -e /dev/tty ]] || die "--purge requires --yes without an interactive terminal"
    printf 'Delete ALL DeepSeek CLI local data under %s? Type PURGE: ' "$HOME/.deepseek-cli" >/dev/tty
    read -r answer </dev/tty
    [[ "$answer" == PURGE ]] || die "Purge cancelled"
  fi
  remove_application
  rm -rf -- "$HOME/.deepseek-cli"
  rm -f -- "$HOME/.deepseek_api_key"
  ok "Application and all DeepSeek CLI local data removed"
  exit 0
fi

command -v python3 >/dev/null 2>&1 || die "Python 3.10+ is required"
PYTHON=python3
"$PYTHON" - <<'PY' || die "Python 3.10+ is required"
import sys
if sys.version_info < (3, 10):
    raise SystemExit(f"found Python {sys.version.split()[0]}")
PY

fetch(){
  local url="$1" output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --tlsv1.2 --retry 2 \
      --connect-timeout 12 --max-time 180 "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --tries=3 --timeout=30 -O "$output" "$url"
  else
    die "curl or wget is required"
  fi
}

verify_hash(){
  local archive="$1" actual
  [[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "Installer has no valid embedded release hash"
  actual="$($PYTHON - "$archive" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b''):
        h.update(chunk)
print(h.hexdigest())
PY
)"
  [[ "$actual" == "$EXPECTED_SHA256" ]] || die "Release checksum mismatch"
}

safe_extract(){
  local archive="$1" destination="$2"
  "$PYTHON" - "$archive" "$destination" <<'PY'
import os, pathlib, sys, tarfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination).resolve()
max_total = 64 * 1024 * 1024
with tarfile.open(archive, 'r:gz') as tf:
    members = tf.getmembers()
    total = 0
    for member in members:
        parts = pathlib.PurePosixPath(member.name).parts
        if not parts or member.name.startswith('/') or '..' in parts:
            raise SystemExit(f'unsafe archive path: {member.name}')
        if member.issym() or member.islnk() or member.isdev():
            raise SystemExit(f'links/devices are not allowed: {member.name}')
        total += max(0, member.size)
        if total > max_total:
            raise SystemExit('release exceeds uncompressed size limit')
        target = (root / member.name).resolve()
        if os.path.commonpath([str(root), str(target)]) != str(root):
            raise SystemExit(f'archive escapes destination: {member.name}')
    try:
        tf.extractall(root, members=members, filter='data')
    except TypeError:  # Python 3.10/3.11 do not expose the filter argument
        tf.extractall(root, members=members)
PY
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P || true)"
SOURCE_DIR=""
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/deepseek-r6.XXXXXX")"
trap 'rm -rf -- "${TEMP_DIR:-}"' EXIT

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/deepseek/version.py" ]]; then
  SOURCE_DIR="$SCRIPT_DIR"
  info "Using verified local source tree"
else
  archive="$TEMP_DIR/release.tar.gz"
  order="${DEEPSEEK_SOURCE_ORDER:-cf,github}"
  downloaded=false
  IFS=',' read -ra sources <<< "$order"
  for source in "${sources[@]}"; do
    case "$source" in
      cf) url="$CF_ARCHIVE" ;;
      github) url="$GH_ARCHIVE" ;;
      *) die "Unknown source in DEEPSEEK_SOURCE_ORDER: $source" ;;
    esac
    info "Downloading $source release"
    if fetch "$url" "$archive"; then
      verify_hash "$archive"
      downloaded=true
      break
    fi
    warn "$source release unavailable"
  done
  [[ "$downloaded" == true ]] || die "No verified release source is available"
  mkdir -p "$TEMP_DIR/extract"
  safe_extract "$archive" "$TEMP_DIR/extract"
  SOURCE_DIR="$TEMP_DIR/extract/deepseek-cli-$RELEASE_ID"
fi

[[ -f "$SOURCE_DIR/deepseek/version.py" ]] || die "Release is missing version.py"
[[ -f "$SOURCE_DIR/requirements.txt" ]] || die "Release is missing requirements.txt"
[[ -f "$SOURCE_DIR/requirements-lock.txt" ]] || die "Release is missing hashed dependency lock"

mkdir -p "$HOME/.deepseek-cli" "$BIN_DIR" "$(dirname "$INSTALL_DIR")"
chmod 0700 "$HOME/.deepseek-cli"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  info "Creating virtual environment"
  "$PYTHON" -m venv "$VENV_DIR"
fi
VENV_PYTHON="$VENV_DIR/bin/python"
"$VENV_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
"$VENV_PYTHON" -m pip --version >/dev/null 2>&1 || die "pip is unavailable; install the Python venv/ensurepip package"
"$VENV_PYTHON" -m pip install --disable-pip-version-check --upgrade 'pip<27'
if [[ -f "$SOURCE_DIR/requirements-lock.txt" ]]; then
  "$VENV_PYTHON" -m pip install --disable-pip-version-check --require-hashes -r "$SOURCE_DIR/requirements-lock.txt"
else
  die "Hashed core dependency lock is missing"
fi
if [[ "$FULL" == true ]]; then
  [[ -f "$SOURCE_DIR/requirements-optional-lock.txt" ]] || die "Hashed optional dependency lock is missing"
  "$VENV_PYTHON" -m pip install --disable-pip-version-check --require-hashes -r "$SOURCE_DIR/requirements-optional-lock.txt"
fi

stage="$(dirname "$INSTALL_DIR")/.deepseek-cli-stage.$$"
backup="$(dirname "$INSTALL_DIR")/.deepseek-cli-backup.$$"
rm -rf -- "$stage" "$backup"
mkdir -p "$stage"
cp -a "$SOURCE_DIR/deepseek" "$stage/deepseek"
cp "$SOURCE_DIR/requirements.txt" "$stage/requirements.txt"
cp "$SOURCE_DIR/requirements-lock.txt" "$stage/requirements-lock.txt"
[[ -f "$SOURCE_DIR/requirements-optional.txt" ]] && cp "$SOURCE_DIR/requirements-optional.txt" "$stage/"
[[ -f "$SOURCE_DIR/requirements-optional-lock.txt" ]] && cp "$SOURCE_DIR/requirements-optional-lock.txt" "$stage/"
[[ -f "$SOURCE_DIR/pyproject.toml" ]] && cp "$SOURCE_DIR/pyproject.toml" "$stage/"
find "$stage" -type d -name __pycache__ -prune -exec rm -rf {} +

"$VENV_PYTHON" - "$stage" "$VERSION" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from deepseek.version import __version__
from deepseek.toolkit import ToolRegistry
assert __version__ == sys.argv[2], (__version__, sys.argv[2])
registry = ToolRegistry()
assert len(registry.tools) >= 80, len(registry.tools)
print(f'verified {__version__} with {len(registry.tools)} tools')
PY

if [[ -e "$INSTALL_DIR" ]]; then mv "$INSTALL_DIR" "$backup"; fi
if ! mv "$stage" "$INSTALL_DIR"; then
  [[ -e "$backup" ]] && mv "$backup" "$INSTALL_DIR"
  die "Atomic application install failed"
fi
rm -rf -- "$backup"

cat > "$BIN_DIR/dscli" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
export DEEPSEEK_ORIGINAL_CWD="\$PWD"
export PYTHONPATH="$INSTALL_DIR\${PYTHONPATH:+:\$PYTHONPATH}"
exec "$VENV_PYTHON" -m deepseek "\$@"
EOF
chmod 0755 "$BIN_DIR/dscli"

ok "Installed DeepSeek CLI $VERSION"
printf 'Launcher: %s\n' "$BIN_DIR/dscli"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR is not in PATH. Add it manually to your shell profile."
fi
