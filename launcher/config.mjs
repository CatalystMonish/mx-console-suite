// Shared settings for the whole suite. The macOS companion app writes this
// file; every console app reads it. Missing file / fields fall back to defaults.
//
//   ~/.mxconsole/config.json
//   {
//     "weather": { "name": "Berlin", "lat": 52.52, "lon": 13.41 },
//     "claude":  { "oauthToken": "sk-ant-oat01-...", "useKeychain": false }
//   }
// (useKeychain=true is an opt-in fallback to read the Claude Code token from the
//  macOS Keychain when no oauthToken is set.)
//
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const CONFIG_PATH = join(homedir(), '.mxconsole', 'config.json')

const DEFAULTS = {
	weather: { name: 'Berlin', lat: 52.52, lon: 13.41 },
	claude: { oauthToken: null, useKeychain: false },
}

export function loadConfig() {
	try {
		const f = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
		return {
			weather: { ...DEFAULTS.weather, ...(f.weather || {}) },
			claude: { ...DEFAULTS.claude, ...(f.claude || {}) },
		}
	} catch {
		return DEFAULTS
	}
}
