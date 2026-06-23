#!/bin/bash
# Build a SELF-CONTAINED MXConsoleCompanion.app: bundles the Node.js runtime, the
# whole suite (JS + node_modules with native prebuilds), and the companion binary.
# The result runs on a Mac with nothing else installed (Node not required).
# All other tools the apps use (osascript, afplay, shortcuts, top, …) are macOS built-ins.
#
# Arch: builds for the host arch by default (arm64 on Apple Silicon). Override with
#   NODE_VER=v22.20.0 ./bundle.sh
set -euo pipefail
cd "$(dirname "$0")"
SUITE_ROOT="$(cd .. && pwd)"
NODE_VER="${NODE_VER:-v22.20.0}"
case "$(uname -m)" in
	arm64) NARCH=arm64 ;;
	x86_64) NARCH=x64 ;;
	*) echo "unsupported arch $(uname -m)"; exit 1 ;;
esac

APP="MXConsoleCompanion.app"
RES="$APP/Contents/Resources"

echo "==> building companion (release)"
swift build -c release

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/runtime" "$RES/suite"
cp .build/release/MXConsoleCompanion "$APP/Contents/MacOS/MXConsoleCompanion"
cp Info.plist "$APP/Contents/Info.plist"

echo "==> fetching Node $NODE_VER (darwin-$NARCH)"
TMP="$(mktemp -d)"
curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-$NARCH.tar.gz" | tar xz -C "$TMP"
cp "$TMP/node-$NODE_VER-darwin-$NARCH/bin/node" "$RES/runtime/node"
chmod +x "$RES/runtime/node"
rm -rf "$TMP"

echo "==> installing suite deps"
( cd "$SUITE_ROOT" && npm install --silent )

echo "==> copying suite (js + node_modules)"
rsync -a --copy-links \
	--exclude 'companion' --exclude '.git' --exclude '.build' \
	--exclude '*.app' --exclude '*preview*.png' --exclude '*.log' \
	--exclude '.DS_Store' --exclude 'node_modules/mx-console-*' \
	"$SUITE_ROOT"/ "$RES/suite"/

echo "==> ad-hoc signing (deep)"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "note: codesign skipped"

echo
echo "Built self-contained $APP (darwin-$NARCH)"
du -sh "$APP"
echo "Run:     open $APP"
echo "Install: cp -r $APP /Applications/ && open /Applications/$APP"
