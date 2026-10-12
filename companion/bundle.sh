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
#
# Signing: with a "Developer ID Application" cert in the keychain the app is signed
# with it (hardened runtime); otherwise ad-hoc (runs only on the Mac that built it
# without a Gatekeeper prompt). SIGN_IDENTITY=<name or SHA-1> picks a cert,
# SIGN_IDENTITY=- forces ad-hoc. Release zips (ZIP=1) are also notarized and
# stapled (NOTARIZE=0 skips, NOTARIZE=1 forces) using the notarytool keychain
# profile NOTARY_PROFILE (default glidepage-notary). One-time setup:
#   xcrun notarytool store-credentials <profile> --apple-id <you@example.com> --team-id <TEAMID>
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
# by SHA-1, since a renewed cert has the same name as the old one
IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk '/"Developer ID Application: / { print $2; exit }')}"
[ "$IDENTITY" = - ] && IDENTITY=
NOTARIZE="${NOTARIZE:-${ZIP:-0}}"
NOTARY_PROFILE="${NOTARY_PROFILE:-glidepage-notary}"
if [ "$NOTARIZE" = 1 ] && [ -z "$IDENTITY" ]; then
	echo "notarizing needs a Developer ID Application cert (or run with NOTARIZE=0)"; exit 1
fi

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
if [ ${#NODES[@]} -gt 1 ]; then
	lipo -create "${NODES[@]}" -output "$RES/runtime/node"
else
	cp "${NODES[0]}" "$RES/runtime/node"
fi
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
# Linux/Windows (and other-arch) prebuilds never load here; drop them.
KEEP=()
for a in "${NARCHS[@]}"; do KEEP+=(! -name "*-darwin-$a"); done
find "$RES/suite/node_modules" -type d -path '*/prebuilds/*' ! -path '*/prebuilds/*/*' "${KEEP[@]}" -prune -exec rm -rf {} +

if [ -z "$IDENTITY" ]; then
	echo "==> ad-hoc signing (deep; no Developer ID cert)"
	codesign --force --deep --sign - "$APP" 2>/dev/null || echo "note: codesign skipped"
else
	echo "==> signing with $(security find-identity -v -p codesigning | grep -m1 -F "$IDENTITY" | sed 's/.*"\(.*\)"/\1/')"
	sign() { codesign --force --timestamp --options runtime --sign "$IDENTITY" "$@"; }
	# inside out: native addons + libvips, then node, then the app (which seals the rest)
	find "$RES/suite" -type f -print0 | xargs -0 file -N | grep Mach-O | grep -v ' (for architecture ' | sed 's/: .*//' | while IFS= read -r f; do
		sign "$f" 2>/dev/null || sign "$f"
	done
	sign --entitlements node.entitlements "$RES/runtime/node"
	sign --entitlements app.entitlements "$APP"
	codesign --verify --deep --strict "$APP"

	if [ "$NOTARIZE" = 1 ]; then
		echo "==> notarizing (a few minutes)"
		ditto -c -k --keepParent "$APP" "$TMP/notarize.zip"
		if ! out="$(xcrun notarytool submit "$TMP/notarize.zip" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1)"; then
			echo "$out"; exit 1
		fi
		echo "$out" | grep -E "^ *(id|status):" | tail -2
		if ! echo "$out" | grep -q "status: Accepted"; then
			xcrun notarytool log "$(echo "$out" | sed -n 's/^ *id: //p' | head -1)" --keychain-profile "$NOTARY_PROFILE" || true
			exit 1
		fi
		# stapling lets the first launch work offline; without it Gatekeeper checks online
		xcrun stapler staple -q "$APP" || echo "note: couldn't staple; Gatekeeper will verify the ticket online"
		spctl --assess --type execute -vv "$APP" 2>&1 | sed 's/^/  /'
	fi
fi

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
