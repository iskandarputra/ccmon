#!/usr/bin/env bash
#
# ccmon build script — packages the desktop app with electron-builder.
#
#   ./build.sh            current platform defaults (linux → .deb + .AppImage)
#   ./build.sh deb        Debian/Ubuntu package
#   ./build.sh appimage   portable Linux AppImage
#   ./build.sh linux      .deb + .AppImage
#   ./build.sh win        Windows NSIS installer + portable .exe
#   ./build.sh all        linux + windows
#   ./build.sh dir        unpacked build (fast, for inspection)
#
set -euo pipefail
cd "$(dirname "$0")"

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; reset=$'\e[0m'
say()  { printf '%s▸ %s%s\n' "$bold" "$1" "$reset"; }
note() { printf '%s  %s%s\n'  "$dim"  "$1" "$reset"; }
warn() { printf '%s! %s%s\n'  "$yellow" "$1" "$reset"; }

TARGET="${1:-auto}"
case "$TARGET" in
  auto)
    case "$(uname -s)" in
      Linux)  ARGS=(--linux) ;;
      Darwin) ARGS=(--mac) ;;
      *)      ARGS=(--win) ;;
    esac ;;
  deb)      ARGS=(--linux deb) ;;
  appimage) ARGS=(--linux AppImage) ;;
  linux)    ARGS=(--linux) ;;
  win|exe)  ARGS=(--win) ;;
  mac)      ARGS=(--mac) ;;
  all)      ARGS=(--linux --win) ;;
  dir)      ARGS=(--dir) ;;
  *) echo "usage: ./build.sh [deb|appimage|linux|win|mac|all|dir]"; exit 1 ;;
esac

command -v node >/dev/null 2>&1 || { echo "error: node >= 20 is required"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "error: node >= 20 required (found $(node -v))"; exit 1
fi

if [ ! -d node_modules ]; then
  say "installing dependencies"
  npm install
fi

say "generating app icon"
npm run icon

say "typechecking"
npm run typecheck

say "building renderer (vite) + electron (esbuild)"
npm run build

say "packaging: ${ARGS[*]}"
if [[ " ${ARGS[*]} " == *"--win"* ]] && [ "$(uname -s)" = "Linux" ]; then
  note "cross-building Windows from Linux usually works (electron-builder bundles NSIS),"
  note "but the GitHub workflow builds it on a native Windows runner if this fails."
fi
npx electron-builder "${ARGS[@]}" --publish never

say "artifacts in release/"
ls -lh release/ 2>/dev/null | awk 'NR>1 && $9 != "" {printf "  %8s  %s\n", $5, $9}' || true
printf '%s✓ done%s\n' "$green" "$reset"
