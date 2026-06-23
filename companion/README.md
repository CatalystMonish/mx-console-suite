# MX Console Companion (macOS)

A native SwiftUI menubar app that runs the console suite and holds its settings.
It writes `~/.mxconsole/config.json`, which every console app reads.

## What it does (v1)

- **Settings UI** — weather location (with city lookup → lat/lon via Open-Meteo)
  and your Claude OAuth token. Saved to `~/.mxconsole/config.json`.
- **Start / Stop launcher** — spawns `node <suite>/launcher/launcher.js` and
  terminates it cleanly (SIGTERM → the launcher clears the panel and exits).
- **Launch at login** — registers the app as a macOS login item (`SMAppService`).

It lives in the menubar (no Dock icon, `LSUIElement`).

## Build & run

Requires Xcode / the Swift toolchain (macOS 13+).

```bash
cd companion
swift run                 # quick dev run (uses your system node + the configured suite folder)
```

### Self-contained app (recommended — runs on any Mac, nothing to install)

```bash
./bundle.sh               # embeds Node + the suite (js + node_modules) into the .app
open MXConsoleCompanion.app
# install so it can launch at login:
cp -r MXConsoleCompanion.app /Applications/ && open /Applications/MXConsoleCompanion.app
```

`bundle.sh` downloads a Node binary, runs `npm install`, and copies the runtime +
suite into `MXConsoleCompanion.app/Contents/Resources/{runtime,suite}`. The app
then prefers that bundled runtime; with no bundle it falls back to your system
node (resolved via the login shell, so nvm/asdf/fnm/Homebrew all work). The only
things the apps shell out to are macOS built-ins (`osascript`, `afplay`,
`shortcuts`, `top`, …) — present on every Mac.

`build-app.sh` is the lightweight variant (companion only, no bundled runtime —
needs Node on the machine).

### Caveats for shipping to other Macs

- **Arch:** `bundle.sh` builds for the host arch (arm64 on Apple Silicon → all
  M-series Macs). For Intel too, build a universal companion and lipo a universal
  node, and add sharp's x64 binaries (`@img/sharp-darwin-x64`).
- **Gatekeeper:** the bundle is ad-hoc signed, so other users must right-click →
  Open (or `xattr -dr com.apple.quarantine MXConsoleCompanion.app`). For a clean
  install experience, sign with a Developer ID and notarize.

## Settings

| Field | Goes to | Notes |
|-------|---------|-------|
| City + **Find** | `weather.name/lat/lon` | "Find" geocodes the city via Open-Meteo. |
| Claude OAuth token | `claude.oauthToken` | Paste your subscription OAuth token (`sk-ant-oat01-…`). Powers the real usage meter. |
| Use Keychain instead | `claude.useKeychain` | Opt-in fallback: read the Claude Code token from the macOS Keychain instead of pasting one. |
| Suite folder | UserDefaults (companion only) | Path to this repo, so it can find `launcher/launcher.js`. |

## Notes

- **Claude token:** the usage endpoint (`/api/oauth/usage`) is undocumented/beta
  and the OAuth token expires; when it does, the Claude tile shows `RE-AUTH` —
  paste a fresh token (or enable the Keychain option).
- **Login item** registration works reliably only from a built, signed `.app`
  (`build-app.sh` ad-hoc signs it); from `swift run` it may be unavailable.
