#!/usr/bin/env bash
# BibzCode CLI 7.8.0-r6 secure installer.
set -Eeuo pipefail
umask 077

VERSION="7.8.0-r6"
RELEASE_ID="7.8.0-r6"
EXPECTED_SHA256="5532b2c73dc40328b2f42bba2c19c2555d519a508289e9a715a7c083c261eade"
LEGACY_ENV_PREFIX='DEEP''SEEK_'
compat_env(){
  local suffix="$1" fallback="${2:-}" primary="BIBZCODE_$1" legacy="${LEGACY_ENV_PREFIX}$1"
  if [[ -n "${!primary:-}" ]]; then printf '%s' "${!primary}"
  elif [[ -n "${!legacy:-}" ]]; then printf '%s' "${!legacy}"
  else printf '%s' "$fallback"
  fi
}
CF_BASE="$(compat_env CF_BASE_URL 'https://bibzcode.bibzflow.workers.dev')"
CF_ARCHIVE="$CF_BASE/releases/bibzcode-cli-$RELEASE_ID.tar.gz"
GH_ARCHIVE="$(compat_env GITHUB_RELEASE_URL "https://raw.githubusercontent.com/XbibzOfficial777/BibzCode/main/releases/bibzcode-cli-$RELEASE_ID.tar.gz")"
INSTALL_DIR="$(compat_env INSTALL_DIR "$HOME/.local/lib/bibzcode-cli")"
VENV_DIR="$(compat_env VENV_DIR "$HOME/.bibzcode-cli/venv")"
BIN_DIR="$(compat_env BIN_DIR "$HOME/.local/bin")"
LEGACY_CONFIG_DIR="$HOME/.deep"'seek-cli'
LEGACY_INSTALL_DIR="$HOME/.local/lib/deep"'seek-cli'
LEGACY_KEY_FILE="$HOME/.deep"'seek_api_key'
FULL=false
ACTION=install
YES=false
NON_INTERACTIVE=false
INSTALL_MODE=""
MODE_EXPLICIT=false

bold='\033[1m'; green='\033[32m'; yellow='\033[33m'; red='\033[31m'; reset='\033[0m'
info(){ printf '› %s\n' "$*"; }
ok(){ printf "%b✓%b %s\n" "$green$bold" "$reset" "$*"; }
warn(){ printf "%b!%b %s\n" "$yellow$bold" "$reset" "$*"; }
die(){ printf "%b✗ %s%b\n" "$red$bold" "$*" "$reset" >&2; exit 1; }

set_install_mode(){
  local requested="$1" normalized
  case "$requested" in
    managed|managed-venv|venv) normalized=managed ;;
    active|active-venv) normalized=active ;;
    user|user-python|default|default-python) normalized=user ;;
    *) die "Unknown install mode: $requested (expected managed, active, or user)" ;;
  esac
  if [[ "$MODE_EXPLICIT" == true && -n "$INSTALL_MODE" && "$INSTALL_MODE" != "$normalized" ]]; then
    die "Conflicting install modes: $INSTALL_MODE and $normalized"
  fi
  INSTALL_MODE="$normalized"
  MODE_EXPLICIT=true
}

usage(){ cat <<EOF
BibzCode CLI $VERSION installer
Usage: bash install.sh [--full] [install mode] [--uninstall|--purge] [--yes]

Install modes (interactive when a terminal is available):
  --managed-venv  create/reuse the dedicated managed venv (recommended/default)
  --active-venv   install dependencies into the currently active VIRTUAL_ENV
  --user-python   use the default Python without a venv (pip --user)

Other options:
  --full            install optional browser/document dependencies
  --non-interactive do not prompt; choose managed venv unless a mode is explicit
  --uninstall       remove application and launcher; preserve data/Python environment
  --purge           remove application plus all local auth/config/sessions (destructive)
  --yes             confirm --purge non-interactively

Environment: BIBZCODE_CF_BASE_URL, BIBZCODE_INSTALL_DIR,
             BIBZCODE_VENV_DIR, BIBZCODE_BIN_DIR, BIBZCODE_PYTHON,
             BIBZCODE_INSTALL_MODE=managed|active|user,
             BIBZCODE_SOURCE_ORDER=cf,github
EOF
}

configured_mode="$(compat_env INSTALL_MODE '')"
if [[ -n "$configured_mode" ]]; then
  set_install_mode "$configured_mode"
fi

for arg in "$@"; do
  case "$arg" in
    --full) FULL=true ;;
    --managed-venv|--venv) set_install_mode managed ;;
    --active-venv) set_install_mode active ;;
    --user-python|--default-python) set_install_mode user ;;
    --non-interactive) NON_INTERACTIVE=true ;;
    --uninstall) ACTION=uninstall ;;
    --purge) ACTION=purge ;;
    --yes|-y) YES=true ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

remove_application(){
  rm -rf -- "$INSTALL_DIR"
  if [[ -L "$LEGACY_INSTALL_DIR" || "$LEGACY_INSTALL_DIR" == "$HOME/.local/lib/deep"'seek-cli' ]]; then
    rm -rf -- "$LEGACY_INSTALL_DIR"
  fi
  rm -f -- "$BIN_DIR/bzcli" "$BIN_DIR/dscli"
}

if [[ "$ACTION" == uninstall ]]; then
  remove_application
  ok "Application removed; config, auth, sessions, uploads, logs, and Python environment preserved"
  exit 0
fi

if [[ "$ACTION" == purge ]]; then
  previous_mode="$(head -n 1 "$HOME/.bibzcode-cli/install-mode" 2>/dev/null || true)"
  if [[ "$YES" != true ]]; then
    [[ -r /dev/tty && -w /dev/tty ]] && (: </dev/tty) 2>/dev/null \
      || die "--purge requires --yes without an interactive terminal"
    printf 'Delete ALL BibzCode CLI local data under %s? Type PURGE: ' "$HOME/.bibzcode-cli" >/dev/tty
    read -r answer </dev/tty
    [[ "$answer" == PURGE ]] || die "Purge cancelled"
  fi
  remove_application
  rm -rf -- "$HOME/.bibzcode-cli" "$LEGACY_CONFIG_DIR"
  rm -f -- "$HOME/.bibzcode_api_key" "$LEGACY_KEY_FILE"
  ok "Application and all BibzCode CLI local data removed"
  if [[ "$previous_mode" == active || "$previous_mode" == user ]]; then
    warn "Dependencies installed in the external Python environment were preserved."
  fi
  exit 0
fi

migrate_legacy_layout(){
  if [[ -d "$LEGACY_CONFIG_DIR" && ! -L "$LEGACY_CONFIG_DIR" && ! -e "$HOME/.bibzcode-cli" ]]; then
    info "Migrating existing CLI data to ~/.bibzcode-cli"
    mv -- "$LEGACY_CONFIG_DIR" "$HOME/.bibzcode-cli"
  fi
  if [[ "$INSTALL_DIR" == "$HOME/.local/lib/bibzcode-cli" \
        && -d "$LEGACY_INSTALL_DIR" && ! -L "$LEGACY_INSTALL_DIR" && ! -e "$INSTALL_DIR" ]]; then
    info "Migrating existing application directory to $INSTALL_DIR"
    mv -- "$LEGACY_INSTALL_DIR" "$INSTALL_DIR"
  fi
}

migrate_legacy_layout

has_controlling_tty(){
  [[ -r /dev/tty && -w /dev/tty ]] && (: </dev/tty) 2>/dev/null
}

choose_install_mode(){
  if [[ "$MODE_EXPLICIT" == true ]]; then return; fi
  if [[ "$NON_INTERACTIVE" == true ]] || ! has_controlling_tty; then
    INSTALL_MODE=managed
    return
  fi

  cat >/dev/tty <<'EOF'

Choose the Python environment for BibzCode CLI:
  1) Managed venv (recommended, isolated, default)
  2) Currently active venv (requires VIRTUAL_ENV)
  3) User/default Python (no venv, installs with pip --user)
EOF
  printf 'Selection [1]: ' >/dev/tty
  read -r selection </dev/tty
  case "${selection:-1}" in
    1) INSTALL_MODE=managed ;;
    2) INSTALL_MODE=active ;;
    3) INSTALL_MODE=user ;;
    *) die "Invalid install-mode selection: $selection" ;;
  esac
}

choose_install_mode

PYTHON_REQUESTED="$(compat_env PYTHON 'python3')"
PYTHON="$(command -v -- "$PYTHON_REQUESTED" 2>/dev/null || true)"
[[ -n "$PYTHON" && -x "$PYTHON" ]] || die "Python 3.10+ is required (not found: $PYTHON_REQUESTED)"
check_python(){
  "$1" - <<'PY' || return 1
import sys
if sys.version_info < (3, 10):
    raise SystemExit(f"found Python {sys.version.split()[0]}")
PY
}
check_python "$PYTHON" || die "Python 3.10+ is required"

RUNTIME_PYTHON=""
case "$INSTALL_MODE" in
  managed)
    info "Install mode: managed venv at $VENV_DIR"
    ;;
  active)
    [[ -n "${VIRTUAL_ENV:-}" ]] || die "--active-venv requires an active VIRTUAL_ENV"
    RUNTIME_PYTHON="$VIRTUAL_ENV/bin/python"
    [[ -x "$RUNTIME_PYTHON" ]] || die "Active venv has no executable Python: $RUNTIME_PYTHON"
    check_python "$RUNTIME_PYTHON" || die "The active venv requires Python 3.10+"
    info "Install mode: active venv at $VIRTUAL_ENV"
    ;;
  user)
    if [[ -n "${VIRTUAL_ENV:-}" && "$PYTHON" == "$VIRTUAL_ENV"/bin/* ]]; then
      die "--user-python cannot use the active venv interpreter; deactivate it or set BIBZCODE_PYTHON"
    fi
    RUNTIME_PYTHON="$PYTHON"
    info "Install mode: user/default Python at $RUNTIME_PYTHON (pip --user)"
    warn "This mode is not isolated and may share dependencies with other user applications."
    ;;
  *) die "Internal error: unresolved install mode" ;;
esac

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
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bibzcode-r6.XXXXXX")"
trap 'rm -rf -- "${TEMP_DIR:-}"' EXIT

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/bibzcode/version.py" ]]; then
  SOURCE_DIR="$SCRIPT_DIR"
  info "Using verified local source tree"
else
  archive="$TEMP_DIR/release.tar.gz"
  order="$(compat_env SOURCE_ORDER 'cf,github')"
  downloaded=false
  IFS=',' read -ra sources <<< "$order"
  for source in "${sources[@]}"; do
    case "$source" in
      cf) url="$CF_ARCHIVE" ;;
      github) url="$GH_ARCHIVE" ;;
      *) die "Unknown source in BIBZCODE_SOURCE_ORDER: $source" ;;
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
  SOURCE_DIR="$TEMP_DIR/extract/bibzcode-cli-$RELEASE_ID"
fi

[[ -f "$SOURCE_DIR/bibzcode/version.py" ]] || die "Release is missing version.py"
[[ -f "$SOURCE_DIR/requirements.txt" ]] || die "Release is missing requirements.txt"
[[ -f "$SOURCE_DIR/requirements-lock.txt" ]] || die "Release is missing hashed dependency lock"

mkdir -p "$HOME/.bibzcode-cli" "$BIN_DIR" "$(dirname "$INSTALL_DIR")"
chmod 0700 "$HOME/.bibzcode-cli"
if [[ ! -e "$LEGACY_CONFIG_DIR" && ! -L "$LEGACY_CONFIG_DIR" ]]; then
  ln -s -- "$HOME/.bibzcode-cli" "$LEGACY_CONFIG_DIR"
fi

PIP_SCOPE=()
case "$INSTALL_MODE" in
  managed)
    if [[ ! -x "$VENV_DIR/bin/python" ]]; then
      info "Creating managed virtual environment"
      "$PYTHON" -m venv "$VENV_DIR"
    fi
    RUNTIME_PYTHON="$VENV_DIR/bin/python"
    check_python "$RUNTIME_PYTHON" || die "The managed venv requires Python 3.10+"
    "$RUNTIME_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
    ;;
  active)
    "$RUNTIME_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
    ;;
  user)
    PIP_SCOPE=(--user --no-warn-script-location)
    # PEP 668 can block even user-site installs. This override remains scoped
    # to --user, so the externally managed system environment is not modified.
    if "$RUNTIME_PYTHON" -m pip install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
      PIP_SCOPE+=(--break-system-packages)
    fi
    ;;
esac

"$RUNTIME_PYTHON" -m pip --version >/dev/null 2>&1 || die "pip is unavailable for the selected Python environment"
if [[ "$INSTALL_MODE" == managed ]]; then
  "$RUNTIME_PYTHON" -m pip install --disable-pip-version-check --upgrade 'pip<27'
fi
"$RUNTIME_PYTHON" -m pip install --disable-pip-version-check "${PIP_SCOPE[@]}" \
  --require-hashes -r "$SOURCE_DIR/requirements-lock.txt"
if [[ "$FULL" == true ]]; then
  [[ -f "$SOURCE_DIR/requirements-optional-lock.txt" ]] || die "Hashed optional dependency lock is missing"
  "$RUNTIME_PYTHON" -m pip install --disable-pip-version-check "${PIP_SCOPE[@]}" \
    --require-hashes -r "$SOURCE_DIR/requirements-optional-lock.txt"
fi

stage="$(dirname "$INSTALL_DIR")/.bibzcode-cli-stage.$$"
backup="$(dirname "$INSTALL_DIR")/.bibzcode-cli-backup.$$"
rm -rf -- "$stage" "$backup"
mkdir -p "$stage"
cp -a "$SOURCE_DIR/bibzcode" "$stage/bibzcode"
[[ -d "$SOURCE_DIR/deepseek" ]] && cp -a "$SOURCE_DIR/deepseek" "$stage/deepseek"
cp "$SOURCE_DIR/requirements.txt" "$stage/requirements.txt"
cp "$SOURCE_DIR/requirements-lock.txt" "$stage/requirements-lock.txt"
[[ -f "$SOURCE_DIR/requirements-optional.txt" ]] && cp "$SOURCE_DIR/requirements-optional.txt" "$stage/"
[[ -f "$SOURCE_DIR/requirements-optional-lock.txt" ]] && cp "$SOURCE_DIR/requirements-optional-lock.txt" "$stage/"
[[ -f "$SOURCE_DIR/pyproject.toml" ]] && cp "$SOURCE_DIR/pyproject.toml" "$stage/"
find "$stage" -type d -name __pycache__ -prune -exec rm -rf {} +

"$RUNTIME_PYTHON" - "$stage" "$VERSION" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from bibzcode.version import __version__
from bibzcode.toolkit import ToolRegistry
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
if [[ "$INSTALL_DIR" == "$HOME/.local/lib/bibzcode-cli" \
      && ! -e "$LEGACY_INSTALL_DIR" && ! -L "$LEGACY_INSTALL_DIR" ]]; then
  ln -s -- "$INSTALL_DIR" "$LEGACY_INSTALL_DIR"
fi

printf '%s\n' "$INSTALL_MODE" > "$HOME/.bibzcode-cli/install-mode"
chmod 0600 "$HOME/.bibzcode-cli/install-mode"

{
  printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail'
  printf 'BIBZCODE_APP_DIR=%q\n' "$INSTALL_DIR"
  printf 'BIBZCODE_PYTHON_BIN=%q\n' "$RUNTIME_PYTHON"
  cat <<'EOF'
export BIBZCODE_ORIGINAL_CWD="$PWD"
export PYTHONPATH="$BIBZCODE_APP_DIR${PYTHONPATH:+:$PYTHONPATH}"
exec "$BIBZCODE_PYTHON_BIN" -m bibzcode "$@"
EOF
} > "$BIN_DIR/bzcli"
chmod 0755 "$BIN_DIR/bzcli"
cp "$BIN_DIR/bzcli" "$BIN_DIR/dscli"
chmod 0755 "$BIN_DIR/dscli"

ok "Installed BibzCode CLI $VERSION using install mode: $INSTALL_MODE"
printf 'Launcher: %s\n' "$BIN_DIR/bzcli"
printf 'Compatibility alias: %s\n' "$BIN_DIR/dscli"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR is not in PATH. Add it manually to your shell profile."
fi
