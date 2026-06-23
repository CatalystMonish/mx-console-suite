// @ts-check
// Claude Usage — your REAL Claude subscription meter on the MX Creative Console.
// Reads the same numbers as claude.ai / the Claude Code `/usage` command, via the
// OAuth usage endpoint (https://api.anthropic.com/api/oauth/usage).
//
// Auth: an OAuth access token from config.claude.oauthToken — set it in the
// macOS companion app. (Optional opt-in: set config.claude.useKeychain=true to
// instead read the Claude Code token from the macOS Keychain; off by default.)
// The token is read-only; this app never writes it back.
//
//   node usage.js            -> drive the console
//   node usage.js --preview  -> write preview.png (no hardware)
//
// NOTE: the usage endpoint is undocumented/beta (anthropic-beta: oauth-2025-04-20)
// and may change without notice.
//
import sharp from 'sharp'
import { execFileSync } from 'child_process'
import { listMXCreativeConsoleDevices, openMxCreativeConsole } from '@logitech-mx-creative-console/node'
import { backCombo } from '../launcher/back-combo.mjs'
import { loadConfig } from '../launcher/config.mjs'

const PREVIEW = process.argv.includes('--preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

// --- auth -----------------------------------------------------------------
function getToken() {
	const cfg = loadConfig().claude
	if (cfg.oauthToken) return cfg.oauthToken
	// opt-in only: read the Claude Code token from the Keychain
	if (cfg.useKeychain) {
		try {
			const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' })
			return JSON.parse(raw)?.claudeAiOauth?.accessToken || null
		} catch { /* fall through */ }
	}
	return null
}
async function fetchUsage() {
	const token = getToken()
	if (!token) return { error: 'NO TOKEN' }
	try {
		const res = await fetch(USAGE_URL, {
			headers: {
				Authorization: `Bearer ${token}`,
				'anthropic-beta': 'oauth-2025-04-20',
				'User-Agent': 'claude-code/2.1.0',
				'Content-Type': 'application/json',
			},
		})
		if (res.status === 401 || res.status === 403) return { error: 'RE-AUTH' }
		if (!res.ok) return { error: `HTTP ${res.status}` }
		return { data: await res.json() }
	} catch {
		return { error: 'OFFLINE' }
	}
}

// --- helpers --------------------------------------------------------------
const clamp = (n) => Math.max(0, Math.min(100, n || 0))
const sevColor = (p) => (p >= 90 ? '#f0506e' : p >= 70 ? '#ffb84d' : '#36d399')
function fmtReset(iso) {
	if (!iso) return '—'
	const ms = new Date(iso).getTime() - Date.now()
	if (ms <= 0) return 'now'
	const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
	if (d > 0) return `${d}d ${h % 24}h`
	if (h > 0) return `${h}h ${m % 60}m`
	return `${m}m`
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// --- tiles ----------------------------------------------------------------
const BG = '#101218'
async function rawFromSvg(svg) {
	return sharp(Buffer.from(svg)).flatten({ background: BG }).removeAlpha().raw().toBuffer()
}
async function blank(S) {
	return rawFromSvg(`<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${BG}"/></svg>`)
}
async function labelTile(S, top, bottom, accent = '#6a6f85') {
	return rawFromSvg(`<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="50%" y="44%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.16}" font-weight="bold" fill="#e8e8ee" letter-spacing="1">${esc(top)}</text>
  <text x="50%" y="68%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" fill="${accent}" letter-spacing="1">${esc(bottom)}</text>
</svg>`)
}
async function statTile(S, value, label, accent) {
	return rawFromSvg(`<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${BG}"/>
  <text x="50%" y="50%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.26}" font-weight="bold" fill="${accent}">${esc(value)}</text>
  <text x="50%" y="80%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" fill="#6a6f85" letter-spacing="2">${esc(label)}</text>
</svg>`)
}
async function gaugeTile(S, pct) {
	const p = clamp(pct), color = sevColor(p)
	const cx = S / 2, cy = S * 0.46, r = S * 0.3, aw = S * 0.085, a0 = 135, span = 270
	const a1 = a0 + (span * p) / 100
	const arc = (s, e) => {
		const pt = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
		const [x0, y0] = pt(s), [x1, y1] = pt(e)
		return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
	}
	return rawFromSvg(`<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${BG}"/>
  <path d="${arc(a0, a0 + span)}" fill="none" stroke="#2a2d36" stroke-width="${aw}" stroke-linecap="round"/>
  ${p > 0 ? `<path d="${arc(a0, a1)}" fill="none" stroke="${color}" stroke-width="${aw}" stroke-linecap="round"/>` : ''}
  <text x="50%" y="${cy + S * 0.08}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.28}" font-weight="bold" fill="#e8e8ee">${Math.round(p)}<tspan font-size="${S * 0.13}" fill="${color}">%</tspan></text>
</svg>`)
}

// --- compose the 9 tiles from a usage payload (or an error) ---------------
function tilesFor(state) {
	if (state.error) {
		// center the message, blank the rest
		return (S, i) => (i === 4 ? labelTile(S, 'CLAUDE', state.error, '#f0506e') : i === 7 ? labelTile(S, '', state.error === 'RE-AUTH' ? 'open Claude Code' : '', '#6a6f85') : blank(S))
	}
	const d = state.data
	const fh = d.five_hour || {}, sd = d.seven_day || {}
	const sonnet = d.seven_day_sonnet?.utilization, opus = d.seven_day_opus?.utilization
	const sp = d.spend || {}
	const used = sp.used ? sp.used.amount_minor / Math.pow(10, sp.used.exponent || 2) : 0
	const limit = sp.limit ? sp.limit.amount_minor / Math.pow(10, sp.limit.exponent || 2) : 0
	return (S, i) => {
		switch (i) {
			case 0: return labelTile(S, 'SESSION', '5-hour')
			case 1: return gaugeTile(S, fh.utilization)
			case 2: return labelTile(S, fmtReset(fh.resets_at), 'resets', sevColor(clamp(fh.utilization)))
			case 3: return labelTile(S, 'WEEKLY', '7-day')
			case 4: return gaugeTile(S, sd.utilization)
			case 5: return labelTile(S, fmtReset(sd.resets_at), 'resets', sevColor(clamp(sd.utilization)))
			case 6: return statTile(S, sonnet == null ? '—' : `${Math.round(sonnet)}%`, 'SONNET', sonnet == null ? '#6a6f85' : sevColor(clamp(sonnet)))
			case 7: return statTile(S, opus == null ? '—' : `${Math.round(opus)}%`, 'OPUS', opus == null ? '#6a6f85' : sevColor(clamp(opus)))
			case 8: return statTile(S, limit ? `$${used.toFixed(0)}` : '—', limit ? `of $${limit.toFixed(0)}` : 'CREDITS', '#b39cff')
			default: return blank(S)
		}
	}
}

// --- device ---------------------------------------------------------------
let device = null
let state = { error: 'LOADING' }
let _painting = false

function lcdKeys() {
	return device.CONTROLS.filter((c) => c.type === 'button' && c.feedbackType === 'lcd')
}
async function render() {
	if (_painting || !device) return
	_painting = true
	try {
		const keys = lcdKeys()
		const S = keys[0].pixelSize.width
		const tile = tilesFor(state)
		for (const k of keys) await device.fillKeyBuffer(k.index, await tile(S, k.index), { format: 'rgb' })
	} finally {
		_painting = false
	}
}
async function refresh() {
	const r = await fetchUsage()
	// keep showing the last good data on transient errors
	if (r.data) state = r
	else if (state.data) state = { ...state, staleError: r.error }
	else state = r
	await render().catch(() => {})
}
async function openDev() {
	const d = await listMXCreativeConsoleDevices()
	if (!d[0]) { console.error('No MX Creative Console connected.'); process.exit(1) }
	let dev, err
	for (let i = 0; i < 6; i++) {
		try { dev = await openMxCreativeConsole(d[0].path); break }
		catch (e) { err = e; await sleep(1000) }
	}
	if (!dev) throw new Error(`Could not open device: ${err?.message || err}`)
	dev.on('error', () => {})
	await dev.clearPanel()
	await dev.setBrightness(100)
	return dev
}

// --- preview (no hardware): render the 9 tiles into one PNG ----------------
async function preview() {
	state = await fetchUsage()
	const S = 120, gap = 8, grid = S * 3 + gap * 4
	const tile = tilesFor(state)
	const composites = []
	for (let i = 0; i < 9; i++) {
		const png = await sharp(await tile(S, i), { raw: { width: S, height: S, channels: 3 } }).png().toBuffer()
		composites.push({ input: png, left: gap + (i % 3) * (S + gap), top: gap + Math.floor(i / 3) * (S + gap) })
	}
	const out = new URL('./preview.png', import.meta.url)
	await sharp({ create: { width: grid, height: grid, channels: 3, background: '#000' } }).composite(composites).png().toFile(out.pathname)
	console.log(`wrote ${out.pathname}`)
	if (state.error) console.log('note:', state.error)
	else console.log(`session ${state.data.five_hour?.utilization}% · weekly ${state.data.seven_day?.utilization}%`)
}

async function main() {
	if (PREVIEW) return preview()
	device = await openDev()
	if (process.env.MX_LAUNCHER) backCombo(device)
	await render() // shows LOADING until first fetch returns
	await refresh()
	console.log('Claude usage (real subscription meter). Inside the launcher, press < + > to return. Ctrl+C to quit.')
	setInterval(() => refresh().catch(() => {}), 60_000) // real data every 60s
	setInterval(() => render().catch(() => {}), 2_000) // keep-alive repaint
}

let quitting = false
async function quit() {
	if (quitting) return
	quitting = true
	try { await device?.clearPanel(); await device?.close() } catch {}
	process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)

main().catch(async (e) => { console.error(e.message || e); process.exit(1) })
