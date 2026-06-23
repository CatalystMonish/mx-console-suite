# mx-console-suite

Custom apps and a home-screen launcher for the **Logitech MX Creative Console**
— the 9-key LCD keypad (3×3) plus 2 physical page buttons (`<` / `>`). A native
macOS **companion app** ships the whole thing as a single, self-contained bundle.

Built on the community
[`@logitech-mx-creative-console`](https://github.com/Julusian/node-logitech-mx-creative-console)
library.

> **macOS only.** The apps drive macOS built-ins (AppleScript, `shortcuts`,
> `afplay`, Activity Monitor, …). Not affiliated with or endorsed by Logitech.

---

## Contents

- [What's inside](#whats-inside)
- [Launcher layout & controls](#launcher-layout--controls)
- [Quick start](#quick-start)
- [First-run setup & permissions](#first-run-setup--permissions)
- [The apps in detail](#the-apps-in-detail)
- [Companion app](#companion-app)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What's inside

| App | Tile | What it does |
|-----|------|--------------|
| **Launcher** | home screen | Live weather · clock · date, app tiles, exit hint. |
| **Focus** | key 5 | Pomodoro-style focus timer; toggles macOS Do Not Disturb. |
| **Vitals** | key 6 | Live system vitals: CPU, memory, disk, network, battery. |
| **Spotify** | key 7 | Mirrors the desktop Spotify app: album-art ambilight + transport. |
| **Claude** | key 8 | Your **real** Claude subscription meter (5-hour + weekly). |
| **Companion** | menubar | Native macOS app: settings + start/stop launcher + launch-at-login. |

---

## Launcher layout & controls

```
┌──────────┬──────────┬──────────┐
│ WEATHER  │  TIME    │  DATE    │   row 1  (live info)
├──────────┼──────────┼──────────┤
│  < + >   │ MX       │  FOCUS   │   row 2
│  (exit)  │ CONSOLE  │          │
├──────────┼──────────┼──────────┤
│ VITALS   │ SPOTIFY  │  CLAUDE  │   row 3  (apps)
└──────────┴──────────┴──────────┘
```

- **Tap an app tile** (Focus / Vitals / Spotify / Claude) → it launches and takes
  over the whole panel.
- **Tap TIME** → toggle 12-hour ⇄ 24-hour.
- **WEATHER** tile shows the current conditions for your configured city
  ([Open-Meteo](https://open-meteo.com/), free, no key; refreshes every 10 min).
- Clock/date refresh ~every 10 s; tiles are re-sent every 2 s so they never revert
  to the device logo.
- **Inside any app, press both page buttons `<` + `>` together** → return to the
  launcher.

---

## Quick start

### Option A — packaged app (recommended, nothing to install)

```bash
cd companion
./bundle.sh                 # embeds Node + the suite into the .app
open MXConsoleCompanion.app
```

A **▦ icon appears in the menubar** (no Dock icon). Click it → set your options →
**Start Launcher**. See [Companion app](#companion-app).

### Option B — from source (for development)

Requires **Node.js ≥ 20**.

```bash
npm install                 # one install at the repo root (npm workspaces)
npm start                   # launch the home screen (= node launcher/launcher.js)
```

Run a single app directly:

```bash
npm start -w mx-console-focus
npm start -w mx-console-vitals
npm start -w mx-console-claude-usage
node spotify-player/spotify.js
```

### Preview without hardware

Render the screens to PNG to check layouts with no device attached:

```bash
npm run preview                          # launcher -> launcher/launcher-preview.png
npm run preview -w mx-console-claude-usage
```

---

## First-run setup & permissions

Some apps need a one-time grant or setup that **can't be bundled**:

| For | Do this once |
|-----|--------------|
| **Console access** | Plug in the device. Quit **Logi Options+** if it grabs the keypad. |
| **Claude tile** | Paste your subscription **OAuth token** in the companion (or enable *Use Keychain*). Without it the tile shows `NO TOKEN`. |
| **Spotify** | Install the **desktop Spotify app**. On first control, approve the macOS **Automation** prompt (“…wants to control Spotify”). |
| **Focus → Do Not Disturb** | Run **`npm run setup-dnd -w mx-console-focus`** — it checks for the `MX Focus On` / `MX Focus Off` Shortcuts and walks you through creating any that are missing. The timer works without them; only DND toggling needs them. |

---

## The apps in detail

### Focus (key 5)
Pomodoro timer with session goal tracking; persists daily stats to
`~/.mxconsole/focus.json`. Plays a chime (`afplay`) on phase change and toggles
DND via `shortcuts`.

- **Keys:** start/pause, skip, +5 min, reset, DND toggle.
- **Env:** `FOCUS_MIN` (25), `BREAK_MIN` (5), `LONGBREAK_MIN` (15), `FOCUS_GOAL` (8).
- **DND setup:** `npm run setup-dnd -w mx-console-focus` (creates/verifies the
  `MX Focus On` / `MX Focus Off` Shortcuts). Without them the DND tile shows `setup`.

### Vitals (key 6)
Live CPU / memory / disk / network / battery from macOS built-ins
(`top`, `vm_stat`, `df`, `pmset`, …). A guarded kill-list prevents killing system
processes.

- **Keys:** double-press a key to kill the top CPU process; a page button opens
  **Activity Monitor**.

### Spotify (key 7)
Mirrors the **desktop Spotify app** over AppleScript (no login/keys). A blurred
album-art "ambilight" spans the panel behind the controls.

- **Keys:** mode (cycles `hero → top6 → info`), shuffle, prev / play-pause / next.
- **Page buttons:** volume −/+.
- **Env:** `SPOTIFY_MODE` (initial layout, default `hero`).

### Claude (key 8)
Shows your **real** Claude subscription usage — the same numbers as claude.ai and
the Claude Code `/usage` command — via `GET api.anthropic.com/api/oauth/usage`.

- 5-hour session gauge + weekly gauge (green → amber → red), reset countdowns,
  per-model weekly, and extra-usage credits.
- **Auth:** `config.claude.oauthToken` (set in the companion), or opt-in
  `useKeychain: true` to read the Claude Code token from the macOS Keychain.
- On an expired token the tile shows `RE-AUTH` — paste a fresh one.

> ⚠️ The usage endpoint is **undocumented/beta** (`anthropic-beta: oauth-2025-04-20`)
> and may change without notice. It is **not** `ccusage` (which only estimates from
> local CLI logs).

---

## Companion app

Native SwiftUI **menubar** app (`companion/`). v1:

- **Settings UI** — weather city (with **Find** → geocodes to lat/lon), Claude
  OAuth token, suite folder. Writes `~/.mxconsole/config.json`.
- **Start / Stop launcher** — spawns/terminates the launcher cleanly.
- **Launch at login** — registers a login item (`SMAppService`).

Build options:

```bash
cd companion
swift run            # dev run (uses your system node + the suite folder)
./bundle.sh          # SELF-CONTAINED .app: bundles Node + suite (runs on any Mac)
./build-app.sh       # lightweight .app: companion only (needs Node on the machine)
```

The bundled app prefers its embedded Node; with no bundle it falls back to your
system node, resolved via the **login shell** (so nvm/asdf/fnm/Homebrew all work).
Full details in [`companion/README.md`](./companion/README.md).

---

## Configuration

All apps read one shared settings file (written by the companion, or edit by hand):

```jsonc
// ~/.mxconsole/config.json
{
  "weather": { "name": "Berlin", "lat": 52.52, "lon": 13.41 },
  "claude":  { "oauthToken": "sk-ant-oat01-…", "useKeychain": false }
}
```

| Key | Meaning |
|-----|---------|
| `weather.name/lat/lon` | Weather tile location. Defaults to Berlin. |
| `claude.oauthToken` | Claude subscription OAuth token. `null` ⇒ Claude tile shows `NO TOKEN`. |
| `claude.useKeychain` | `true` ⇒ read the Claude Code token from the Keychain when no `oauthToken`. Default `false`. |

`launcher/config.mjs` loads this with the above defaults.

---

## How it works

- **One process owns the keypad.** The launcher paints the home tiles; tapping an
  app tile makes the launcher **release the device** (`clearPanel` + `close`),
  spawn the app as a child with `MX_LAUNCHER=1`, and wait. When the app exits, the
  launcher **reopens** the device and repaints.
- **Exit combo.** `launcher/back-combo.mjs` (imported by each app as
  `../launcher/back-combo.mjs`) registers the `<` + `>` press → the app clears,
  closes, and exits, handing control back.
- **Keep-alive.** The console reverts un-refreshed keys to its logo, so both the
  launcher and the apps re-send their tiles on a short interval.
- **Rendering.** Tiles are SVG → raw RGB via `sharp`, pushed with
  `device.fillKeyBuffer(index, buf, { format: 'rgb' })`.

---

## Project layout

```
mx-console-suite/
  package.json          # npm workspaces root
  launcher/
    launcher.js         # home screen: weather / clock / date + app tiles
    back-combo.mjs      # shared < + > exit handler
    config.mjs          # shared ~/.mxconsole/config.json loader
    assets/             # claude.png, spotify.png, timer.png (tile icons)
  spotify-player/        spotify.js
  claude-usage/          usage.js   (real subscription meter)
  vitals/                vitals.js
  focus/                 focus.js
  companion/             native SwiftUI menubar app + bundle.sh / build-app.sh
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **“No MX Creative Console connected”** | Check USB; quit **Logi Options+**; kill any stray launcher (`pkill -f launcher.js`). |
| **Start Launcher does nothing** | Check `~/.mxconsole/launcher.log`. From source, ensure `node` is on your login-shell `PATH`. |
| **Claude tile = `NO TOKEN` / `RE-AUTH`** | Paste a fresh OAuth token in the companion (or enable *Use Keychain*). |
| **Spotify tile blank** | Open the desktop Spotify app and approve the Automation prompt. |
| **Focus DND not toggling** | Create the `MX Focus On` / `MX Focus Off` Shortcuts. |
| **Gatekeeper blocks the .app** | `xattr -dr com.apple.quarantine MXConsoleCompanion.app`, or right-click → **Open**. |

---

## License

MIT — see [LICENSE](./LICENSE).

---

If you find this useful, you can support the work here:
[☕ Buy me a coffee](https://buymeacoffee.com/monishmeher)
