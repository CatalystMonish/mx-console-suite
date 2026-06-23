#!/bin/bash
# Build a proper MXConsoleCompanion.app bundle (menubar agent). Needed for the
# "Launch at login" item and the no-Dock-icon behaviour to work correctly.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN=".build/release/MXConsoleCompanion"
APP="MXConsoleCompanion.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/MXConsoleCompanion"
cp Info.plist "$APP/Contents/Info.plist"
cp icon/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# ad-hoc codesign so login-item registration works locally
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "note: codesign skipped"

echo "Built $APP"
echo "Run it:           open $APP"
echo "Install (login):  cp -r $APP /Applications/ && open /Applications/$APP"
