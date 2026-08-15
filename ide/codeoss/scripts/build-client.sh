#!/usr/bin/env bash
set -euo pipefail
OVERLAY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.."&&pwd)";SOURCE="${BIBZCODE_CODEOSS_SOURCE:-$OVERLAY_ROOT/.work/vscode}";RELEASE="${BIBZCODE_CODEOSS_RELEASE:-$OVERLAY_ROOT/release}";PLATFORM="${BIBZCODE_BUILD_PLATFORM:-}";ARCH="${BIBZCODE_BUILD_ARCH:-${VSCODE_ARCH:-x64}}"
if [[ -z "$PLATFORM" ]];then case "$(uname -s)" in Linux*)PLATFORM=linux;;Darwin*)PLATFORM=darwin;;MINGW*|MSYS*|CYGWIN*)PLATFORM=win32;;*)exit 2;;esac;fi
[[ -f "$SOURCE/BIBZCODE_UPSTREAM.json" ]]||node "$OVERLAY_ROOT/scripts/prepare-upstream.mjs" --destination "$SOURCE";mkdir -p "$RELEASE";export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" VSCODE_ARCH="$ARCH" npm_config_arch="$ARCH" ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1;cd "$SOURCE";[[ "${BIBZCODE_SKIP_INSTALL:-0}" == 1 ]]||npm ci;npm run gulp vscode-min-prepack
case "$PLATFORM" in
linux) npm run gulp "vscode-linux-${ARCH}-min-packing";npm run gulp "vscode-linux-${ARCH}-prepare-deb";npm run gulp "vscode-linux-${ARCH}-build-deb";npm run gulp "vscode-linux-${ARCH}-prepare-rpm";npm run gulp "vscode-linux-${ARCH}-build-rpm";tar -C "$(dirname "$SOURCE")/VSCode-linux-${ARCH}" -czf "$RELEASE/BibzCode-IDE-7.8.0-r6-linux-${ARCH}.tar.gz" .;find "$SOURCE/.build/linux" -type f \( -name '*.deb' -o -name '*.rpm' \) -exec cp {} "$RELEASE/" \;;;
win32) npm run gulp "vscode-win32-${ARCH}-min-packing";npm run gulp "vscode-win32-${ARCH}-user-setup";powershell.exe -NoProfile -Command "Compress-Archive -Force -Path '$(cygpath -w "$(dirname "$SOURCE")/VSCode-win32-${ARCH}")\\*' -DestinationPath '$(cygpath -w "$RELEASE/BibzCode-IDE-7.8.0-r6-win-${ARCH}-portable.zip")'";find "$SOURCE/.build/win32-${ARCH}/user-setup" -maxdepth 1 -type f -name '*.exe' -exec cp {} "$RELEASE/" \;;;
darwin) npm run gulp "vscode-darwin-${ARCH}-min-packing";(cd "$(dirname "$SOURCE")/VSCode-darwin-${ARCH}"&&zip -q -r -X -y "$RELEASE/BibzCode-IDE-7.8.0-r6-mac-${ARCH}.zip" .);;
*)exit 2;;esac
cd "$RELEASE";find . -maxdepth 1 -type f ! -name SHA256SUMS -print0|sort -z|xargs -0 sha256sum>SHA256SUMS;cat SHA256SUMS
