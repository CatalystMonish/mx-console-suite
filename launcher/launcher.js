// @ts-check
// MX Console — master launcher. Shows the apps on the keypad; press a key to
// launch one. Inside an app, press the two physical page buttons (< + >, index
// 9 + 10) together to come back here. The keypad is exclusive to one process,
// so the launcher hands the device to the app and takes it back when it exits.
//
//   node launcher.js            -> drive the console
//   node launcher.js --preview  -> write launcher-preview.png (no hardware)
//
// Screen layout (3x3 LCD grid, indices 0-8):
//   [ blank   ] [ TIME    ] [ DATE    ]
//   [ < + >   ] [ MX CONSOLE] [ FOCUS  ]
//   [ VITALS  ] [ CLAUDE   ] [ SPOTIFY ]
//
import sharp from 'sharp'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { listMXCreativeConsoleDevices, openMxCreativeConsole } from '@logitech-mx-creative-console/node'
import { loadConfig } from './config.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PREVIEW = process.argv.includes('--preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ASSET = (name) => join(ROOT, 'assets', name)
// Weather (key 0) via Open-Meteo — free, no API key. Location comes from the
// shared config (the companion app); defaults to Berlin. Re-read each fetch so
// a location change takes effect within the refresh interval.
let WEATHER_LOC = loadConfig().weather
let weather = null // { temp: number, code: number }

// App tiles. Each launches a child process with MX_LAUNCHER=1 so its back-combo
// (< + >) is active. Keys: FOCUS=5, VITALS=6, CLAUDE=7, SPOTIFY=8.
// Tiles with `icon` render the PNG (from launcher/assets) centered above the
// label on a solid `bg`; the rest fall back to a drawn `glyph` + gradient.
const APPS = [
	{ key: 5, name: 'FOCUS', dir: 'focus', script: 'focus.js', icon: 'timer.png', bg: '#6354e0', iconScale: 0.81, env: {} },
	{ key: 6, name: 'VITALS', dir: 'vitals', script: 'vitals.js', colors: ['#36d399', '#149c5a'], glyph: 'pulse', env: {} },
	{ key: 8, name: 'CLAUDE', dir: 'claude-usage', script: 'usage.js', icon: 'claude.png', bg: '#D77655', iconScale: 1.05, env: {} },
	{ key: 7, name: 'SPOTIFY', dir: 'spotify-player', script: 'spotify.js', icon: 'spotify.png', bg: '#1db954', iconScale: 0.9, env: {} },
]

let device = null
let childRunning = false
let use24 = false // time tile: 12-hour by default; press key 1 to toggle to 24-hour

// --- tiles ----------------------------------------------------------------
function glyphSvg(kind, S, c) {
	if (kind === 'spotify') {
		return `<circle cx="${S / 2}" cy="${S * 0.4}" r="${S * 0.2}" fill="#fff"/>
			<g fill="none" stroke="${c}" stroke-width="${S * 0.03}" stroke-linecap="round">
			<path d="M${S * 0.4} ${S * 0.37} q${S * 0.1} -0.04 ${S * 0.2} ${S * 0.02}"/>
			<path d="M${S * 0.41} ${S * 0.42} q${S * 0.09} -0.03 ${S * 0.18} ${S * 0.02}"/>
			<path d="M${S * 0.42} ${S * 0.47} q${S * 0.08} -0.02 ${S * 0.16} ${S * 0.02}"/></g>`
	}
	if (kind === 'timer') {
		const cx = S / 2, cy = S * 0.4, r = S * 0.18
		return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${S * 0.04}"/><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.62}" stroke="#fff" stroke-width="${S * 0.04}" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${cx + r * 0.5}" y2="${cy + r * 0.18}" stroke="#fff" stroke-width="${S * 0.035}" stroke-linecap="round"/>`
	}
	if (kind === 'pulse') {
		const cy = S * 0.34, cx = S * 0.5, k = 0.78 // scale the waveform down a touch about its center, nudged up
		return `<g transform="translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})"><polyline points="${S * 0.2},${cy} ${S * 0.37},${cy} ${S * 0.45},${cy - S * 0.13} ${S * 0.53},${cy + S * 0.15} ${S * 0.61},${cy} ${S * 0.8},${cy}" fill="none" stroke="#fff" stroke-width="${S * 0.045}" stroke-linecap="round" stroke-linejoin="round"/></g>`
	}
	if (kind === 'gauge') {
		const cx = S / 2, cy = S * 0.4, r = S * 0.17, aw = S * 0.06
		const arc = (a0, a1) => { const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}` }
		return `<path d="${arc(135, 405)}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="${aw}" stroke-linecap="round"/><path d="${arc(135, 135 + 270 * 0.66)}" fill="none" stroke="#fff" stroke-width="${aw}" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${S * 0.035}" fill="#fff"/>`
	}
	return ''
}
async function appTile(app, S) {
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${app.colors[0]}"/><stop offset="1" stop-color="${app.colors[1]}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${glyphSvg(app.glyph, S, app.colors[1])}
  <text x="50%" y="${S * 0.82}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.13}" font-weight="bold" fill="#fff" letter-spacing="1">${app.name}</text>
</svg>`
	return sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
async function labelTile(top, bottom, S) {
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0c0d12"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.17}" font-weight="bold" fill="#e8e8ee" letter-spacing="1">${esc(top)}</text>
  <text x="50%" y="66%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" fill="#6a6f85">${esc(bottom)}</text>
</svg>`
	return sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
}
// Live clock tile (key 1). 12-hour h:MM + small AM/PM by default; press to flip.
async function clockTile(S) {
	const d = new Date()
	let h = d.getHours()
	const m = String(d.getMinutes()).padStart(2, '0')
	let big, sub
	if (use24) { big = `${String(h).padStart(2, '0')}:${m}`; sub = '24-HOUR' }
	else { const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; big = `${h}:${m}`; sub = ap }
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#101218"/>
  <text x="50%" y="48%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.26}" font-weight="bold" fill="#e8e8ee" letter-spacing="1">${big}</text>
  <text x="50%" y="72%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.12}" font-weight="bold" fill="#7c84ff" letter-spacing="2">${sub}</text>
</svg>`
	return sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
}
// Live date tile (key 2). Weekday + "Mon DD".
async function dateTile(S) {
	const d = new Date()
	const wk = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()]
	const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#101218"/>
  <text x="50%" y="42%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.15}" font-weight="bold" fill="#36d399" letter-spacing="3">${wk}</text>
  <text x="50%" y="72%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.2}" font-weight="bold" fill="#e8e8ee">${mo} ${d.getDate()}</text>
</svg>`
	return sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
}
// Icon tile: a PNG mark (from launcher/assets), small and centered above the
// label, on the app's solid background colour.
async function iconTile(app, S) {
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${app.bg}"/>
  <text x="50%" y="${S * 0.82}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.13}" font-weight="bold" fill="#fff" letter-spacing="1">${app.name}</text>
</svg>`
	const size = Math.round(S * 0.42 * (app.iconScale ?? 1))
	const icon = await sharp(ASSET(app.icon)).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
	// keep the icon vertically centered in the upper area regardless of its size
	const top = Math.round(S * 0.34 - size / 2)
	return sharp(Buffer.from(svg))
		.composite([{ input: icon, left: Math.round((S - size) / 2), top }])
		.flatten({ background: app.bg })
		.removeAlpha()
		.raw()
		.toBuffer()
}
async function blank(S) { return sharp({ create: { width: S, height: S, channels: 3, background: '#0c0d12' } }).raw().toBuffer() }

// WMO weather-code -> short label (https://open-meteo.com/en/docs)
function weatherLabel(code) {
	if (code === 0) return 'CLEAR'
	if (code <= 3) return 'CLOUDY'
	if (code <= 48) return 'FOG'
	if (code <= 67) return 'RAIN'
	if (code <= 77) return 'SNOW'
	if (code <= 82) return 'SHOWERS'
	if (code <= 86) return 'SNOW'
	return 'STORM'
}
async function fetchWeather() {
	try {
		WEATHER_LOC = loadConfig().weather
		const u = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LOC.lat}&longitude=${WEATHER_LOC.lon}&current=temperature_2m,weather_code`
		const res = await fetch(u)
		if (!res.ok) throw new Error(`weather ${res.status}`)
		const j = await res.json()
		weather = { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code }
	} catch (e) { /* keep last good value */ }
}
// --- weather glyphs (centered at cx,cy; u = base unit) --------------------
const W_WHITE = '#e8e8ee', W_SUN = '#ffd24a', W_BLUE = '#5ab0ff'
function wCloud(cx, cy, u, fill = W_WHITE) {
	return `<g fill="${fill}"><circle cx="${cx - u * 0.7}" cy="${cy + u * 0.2}" r="${u * 0.55}"/><circle cx="${cx + u * 0.1}" cy="${cy - u * 0.25}" r="${u * 0.72}"/><circle cx="${cx + u * 0.85}" cy="${cy + u * 0.15}" r="${u * 0.55}"/><rect x="${cx - u * 1.2}" y="${cy + u * 0.18}" width="${u * 2.4}" height="${u * 0.72}" rx="${u * 0.36}"/></g>`
}
function wSun(cx, cy, u) {
	let rays = ''
	for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rays += `<line x1="${(cx + Math.cos(a) * u * 1.05).toFixed(1)}" y1="${(cy + Math.sin(a) * u * 1.05).toFixed(1)}" x2="${(cx + Math.cos(a) * u * 1.5).toFixed(1)}" y2="${(cy + Math.sin(a) * u * 1.5).toFixed(1)}" stroke="${W_SUN}" stroke-width="${u * 0.2}" stroke-linecap="round"/>` }
	return `${rays}<circle cx="${cx}" cy="${cy}" r="${u * 0.85}" fill="${W_SUN}"/>`
}
function wPrecip(cx, cy, u, kind) {
	const y = cy + u * 1.05
	return [-0.6, 0, 0.6].map((dx) => {
		const x = cx + u * dx
		return kind === 'snow'
			? `<circle cx="${x.toFixed(1)}" cy="${(y + u * 0.3).toFixed(1)}" r="${u * 0.17}" fill="${W_WHITE}"/>`
			: `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - u * 0.2).toFixed(1)}" y2="${(y + u * 0.55).toFixed(1)}" stroke="${W_BLUE}" stroke-width="${u * 0.17}" stroke-linecap="round"/>`
	}).join('')
}
function weatherIcon(code, S, cx, cy, u) {
	if (code === 0) return wSun(cx, cy, u)
	if (code <= 3) return wCloud(cx, cy, u)
	if (code <= 48) { // fog
		const ly = cy + u * 1.1
		return wCloud(cx, cy, u) + [0, 1, 2].map((i) => `<line x1="${cx - u * 1.1}" y1="${(ly + i * u * 0.4).toFixed(1)}" x2="${cx + u * 1.1}" y2="${(ly + i * u * 0.4).toFixed(1)}" stroke="${W_WHITE}" stroke-width="${u * 0.14}" stroke-linecap="round" opacity="0.7"/>`).join('')
	}
	if (code <= 67) return wCloud(cx, cy, u) + wPrecip(cx, cy, u, 'rain')
	if (code <= 77) return wCloud(cx, cy, u) + wPrecip(cx, cy, u, 'snow')
	if (code <= 86) return wCloud(cx, cy, u) + wPrecip(cx, cy, u, code >= 85 ? 'snow' : 'rain')
	// thunderstorm
	return wCloud(cx, cy, u) + `<polygon points="${cx},${(cy + u * 0.9).toFixed(1)} ${(cx - u * 0.4).toFixed(1)},${(cy + u * 1.65).toFixed(1)} ${(cx - u * 0.05).toFixed(1)},${(cy + u * 1.55).toFixed(1)} ${(cx - u * 0.2).toFixed(1)},${(cy + u * 2.3).toFixed(1)} ${(cx + u * 0.45).toFixed(1)},${(cy + u * 1.35).toFixed(1)} ${(cx + u * 0.05).toFixed(1)},${(cy + u * 1.45).toFixed(1)}" fill="${W_SUN}"/>`
}
// Weather tile (key 0): city on top, icon next to the temperature, condition below.
async function weatherTile(S) {
	const temp = weather ? `${weather.temp}°` : '—'
	const cond = weather ? weatherLabel(weather.code) : 'WEATHER'
	const icon = weather ? weatherIcon(weather.code, S, S * 0.3, S * 0.54, S * 0.1) : ''
	const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#101218"/>
  <text x="50%" y="22%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.11}" fill="#6a6f85" letter-spacing="2">${esc(WEATHER_LOC.name.toUpperCase())}</text>
  ${icon}
  <text x="62%" y="62%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.24}" font-weight="bold" fill="#e8e8ee">${temp}</text>
  <text x="50%" y="88%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" font-weight="bold" fill="${W_BLUE}" letter-spacing="1">${cond}</text>
</svg>`
	return sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
}

// Build the buffer for a single key index.
async function tileFor(index, S) {
	const app = APPS.find((a) => a.key === index)
	if (app) return app.icon ? iconTile(app, S) : appTile(app, S)
	if (index === 0) return weatherTile(S)
	if (index === 1) return clockTile(S)
	if (index === 2) return dateTile(S)
	if (index === 3) return labelTile('< + >', 'exit apps', S)
	if (index === 4) return labelTile('MX', 'CONSOLE', S)
	return blank(S)
}

function lcdKeys() {
	return device.CONTROLS.filter((c) => c.type === 'button' && c.feedbackType === 'lcd')
}
// Keys 1 (clock) and 2 (date) are re-rendered every frame; the rest are static
// and cached so we only build their buffers once.
const isDynamic = (idx) => idx === 0 || idx === 1 || idx === 2
let staticCache = null // index -> RGB Buffer
async function buildStatic() {
	const keys = lcdKeys()
	const S = keys[0].pixelSize.width
	staticCache = new Map()
	for (const k of keys) if (!isDynamic(k.index)) staticCache.set(k.index, await tileFor(k.index, S))
}
// Re-send every key each tick. The MX Console reverts un-refreshed keys to its
// logo, so this keep-alive runs on a short interval (mirrors spotify.js).
let _painting = false
async function repaintAll() {
	if (childRunning || !device || _painting) return
	_painting = true
	try {
		if (!staticCache) await buildStatic()
		const keys = lcdKeys()
		const S = keys[0].pixelSize.width
		for (const k of keys) {
			const buf = isDynamic(k.index) ? await tileFor(k.index, S) : staticCache.get(k.index)
			if (buf) await device.fillKeyBuffer(k.index, buf, { format: 'rgb' })
		}
	} finally { _painting = false }
}

// --- device ---------------------------------------------------------------
function onDown(c) {
	if (childRunning || !c || c.type !== 'button') return
	if (c.index === 1) { use24 = !use24; repaintAll().catch(() => {}); return }
	const app = APPS.find((a) => a.key === c.index)
	if (app) launch(app).catch((e) => console.error('launch:', e.message))
}
async function openDev() {
	const d = await listMXCreativeConsoleDevices()
	if (!d[0]) { console.error('No MX Creative Console connected.'); process.exit(1) }
	let dev, err
	for (let i = 0; i < 8; i++) {
		try { dev = await openMxCreativeConsole(d[0].path); break }
		catch (e) { err = e; await sleep(800) }
	}
	if (!dev) throw new Error(`Could not open device: ${err?.message || err}`)
	dev.on('error', () => {})
	dev.on('down', onDown)
	await dev.clearPanel()
	await dev.setBrightness(100)
	return dev
}

async function launch(app) {
	const args = [join(ROOT, '..', app.dir, app.script)]
	console.log(`\n▶ launching ${app.name} ...`)
	childRunning = true
	try { await device.clearPanel(); await device.close() } catch {}
	device = null
	await sleep(500) // let the USB handle fully release

	const env = { ...process.env, MX_LAUNCHER: '1', PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, ...app.env }
	const child = spawn(process.execPath, args, { cwd: join(ROOT, '..', app.dir), env, stdio: 'inherit' })
	await new Promise((res) => child.on('exit', res))
	childRunning = false
	console.log(`◀ back to launcher`)
	device = await openDev()
	staticCache = null // rebuilt on next repaint against the freshly reopened device
	await repaintAll()
}

// --- preview (no hardware): render the 9 tiles into one PNG -----------------
async function preview() {
	await fetchWeather()
	const S = 120, gap = 8, grid = S * 3 + gap * 4
	const composites = []
	for (let idx = 0; idx < 9; idx++) {
		const raw = await tileFor(idx, S)
		const png = await sharp(raw, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer()
		const row = Math.floor(idx / 3), col = idx % 3
		composites.push({ input: png, left: gap + col * (S + gap), top: gap + row * (S + gap) })
	}
	const out = join(ROOT, 'launcher-preview.png')
	await sharp({ create: { width: grid, height: grid, channels: 3, background: '#000' } }).composite(composites).png().toFile(out)
	console.log(`wrote ${out}`)
}

async function main() {
	if (PREVIEW) return preview()
	device = await openDev()
	fetchWeather() // fire-and-forget; the next repaint picks it up
	setInterval(() => fetchWeather().catch(() => {}), 600_000) // refresh every 10 min
	await repaintAll()
	console.log('MX Console launcher. Press a key to open an app; inside an app press the two page buttons (< + >) together to return. Press the TIME tile to toggle 12/24-hour. Ctrl+C to quit.')
	// keep-alive: re-send all tiles every 2s so nothing reverts to the logo; the
	// clock/date tiles pick up the current time on each tick.
	setInterval(() => repaintAll().catch(() => {}), 2000)
}

let quitting = false
async function quit() {
	if (quitting) return
	quitting = true
	try { await device?.clearPanel(); await device?.close() } catch {}
	process.exit(0)
}
process.on('SIGINT', () => { if (childRunning) return; console.log('\nbye'); quit() })
process.on('SIGTERM', () => quit())

main().catch(async (e) => { console.error(e.message || e); process.exit(1) })
