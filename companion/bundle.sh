#!/bin/bash
# Build a SELF-CONTAINED MXConsoleCompanion.app: bundles the Node.js runtime, the
# whole suite (JS + node_modules with native prebuilds), and the companion binary.
# The result runs on a Mac with nothing else installed (Node not required).
# All other tools the apps use (osascript, afplay, shortcuts, top, …) are macOS built-ins.
#
# Arch: builds for the host arch by default. Override with ARCH (cross-builds work
# from either host):
#   ARCH=arm64 ./bundle.sh        # Apple Silicon
#   ARCH=x64 ./bundle.sh          # Intel
#   ARCH=universal ./bundle.sh    # both in one .app (~2x size: two Node runtimes)
# ZIP=1 also writes MXConsoleCompanion-macos-<arch>.zip (for a GitHub release).
# Node version: NODE_VER=v22.20.0 ./bundle.sh
set -euo pipefail
cd "$(dirname "$0")"
SUITE_ROOT="$(cd .. && pwd)"
NODE_VER="${NODE_VER:-v22.20.0}"
if [ -z "${ARCH:-}" ]; then
	case "$(uname -m)" in
		arm64) ARCH=arm64 ;;
		x86_64) ARCH=x64 ;;
		*) echo "unsupported arch $(uname -m)"; exit 1 ;;
	esac
fi
# Node/npm arch names (arm64, x64); Swift wants x86_64 for x64.
case "$ARCH" in
	arm64) NARCHS=(arm64) ;;
	x64) NARCHS=(x64) ;;
	universal) NARCHS=(arm64 x64) ;;
	*) echo "ARCH must be arm64, x64 or universal (got $ARCH)"; exit 1 ;;
esac
SWIFT_FLAGS=(-c release)
for a in "${NARCHS[@]}"; do SWIFT_FLAGS+=(--arch "${a/x64/x86_64}"); done

APP="MXConsoleCompanion.app"
RES="$APP/Contents/Resources"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> building companion (release, $ARCH)"
swift build "${SWIFT_FLAGS[@]}"
BIN="$(swift build "${SWIFT_FLAGS[@]}" --show-bin-path)/MXConsoleCompanion"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/runtime" "$RES/suite"
cp "$BIN" "$APP/Contents/MacOS/MXConsoleCompanion"
cp Info.plist "$APP/Contents/Info.plist"
cp icon/AppIcon.icns "$RES/AppIcon.icns"

NODES=()
for a in "${NARCHS[@]}"; do
	echo "==> fetching Node $NODE_VER (darwin-$a)"
	curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-$a.tar.gz" | tar xz -C "$TMP"
	NODES+=("$TMP/node-$NODE_VER-darwin-$a/bin/node")
done
lipo -create "${NODES[@]}" -output "$RES/runtime/node"
chmod +x "$RES/runtime/node"

echo "==> installing suite deps"
( cd "$SUITE_ROOT" && npm install --silent )

echo "==> copying suite (js + node_modules)"
rsync -a --copy-links \
	--exclude 'companion' --exclude '.git' --exclude '.build' \
	--exclude '*.app' --exclude '*preview*.png' --exclude '*.log' \
	--exclude '.DS_Store' --exclude 'node_modules/mx-console-*' \
	"$SUITE_ROOT"/ "$RES/suite"/

# npm only installs sharp's native package for the host arch, so swap in the
# target arch(es) at the exact versions sharp pins. (node-hid and jpeg-turbo
# already ship prebuilds for both darwin arches.)
IMG="$RES/suite/node_modules/@img"
rm -rf "$IMG"/sharp-darwin-* "$IMG"/sharp-libvips-darwin-*
for a in "${NARCHS[@]}"; do
	for pkg in "sharp-darwin-$a" "sharp-libvips-darwin-$a"; do
		ver="$(node -p "require('$SUITE_ROOT/node_modules/sharp/package.json').optionalDependencies['@img/$pkg']")"
		echo "==> adding @img/$pkg@$ver"
		npm pack "@img/$pkg@$ver" --pack-destination "$TMP" --silent >/dev/null
		mkdir -p "$IMG/$pkg"
		tar xzf "$TMP/img-$pkg-$ver.tgz" -C "$IMG/$pkg" --strip-components 1
	done
done

echo "==> ad-hoc signing (deep)"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "note: codesign skipped"

if [ "${ZIP:-}" = 1 ]; then
	ZIPFILE="MXConsoleCompanion-macos-$ARCH.zip"
	echo "==> zipping $ZIPFILE"
	rm -f "$ZIPFILE"
	ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIPFILE"
fi

echo
echo "Built self-contained $APP (darwin-$ARCH)"
echo "  companion: $(lipo -archs "$APP/Contents/MacOS/MXConsoleCompanion")   node: $(lipo -archs "$RES/runtime/node")"
du -sh "$APP"
echo "Run:     open $APP"
echo "Install: cp -r $APP /Applications/ && open /Applications/$APP"
