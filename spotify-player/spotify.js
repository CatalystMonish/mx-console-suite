// @ts-check
// MX Console Spotify — mirror the local macOS Spotify app on the MX Creative
// Keypad, with a Govee-style ambilight: a blurred copy of the album art fills
// the whole panel behind the icons/text, so the art appears to extend across
// the surrounding screens.
//
// Layouts (mode button = key 2 cycles): hero -> top6 -> info.
//   hero: art centered, buttons around it.
//   top6: art across the top 6, buttons in the side bars, transport on bottom.
//   info: small center art; track/artist/album text tiles.
// Controls the Spotify DESKTOP app via AppleScript (osascript). No login/keys.
//
import sharp from 'sharp'
import { execFile } from 'child_process'
import { listMXCreativeConsoleDevices, openMxCreativeConsole } from '@logitech-mx-creative-console/node'
import { backCombo } from '../launcher/back-combo.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const GREEN = '#1db954', GREY = '#4a4a52', WHITE = '#e8e8ee'

const CTRL = { shuffle: 0, mode: 2, prev: 6, play: 7, next: 8 }
const MODE_ORDER = ['hero', 'top6', 'info']
const LAYOUTS = {
	hero: { art: 'centered', overlays: { 0: 'tl', 2: 'tr', 6: 'bl', 7: 'bc', 8: 'br' } },
	top6: { art: 'top', overlays: { 0: 'ml', 2: 'mr' }, icons: [6, 7, 8] },
	info: { art: 'center4', icons: [0, 2, 6, 7, 8], text: { 1: 'name', 3: 'artist', 5: 'album' } },
}
const INNER = 276 // album-art square size (hero + top6)
const TEXT_META = { name: ['TRACK', GREEN], artist: ['ARTIST', '#4ea8ff'], album: ['ALBUM', '#c084fc'] }

let device = null
let allKeys = []
let artMode = process.env.SPOTIFY_MODE || 'hero'

// --- AppleScript bridge ---------------------------------------------------
const osa = (script) =>
	new Promise((resolve) => {
		execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) => resolve(err ? null : stdout.trim()))
	})
const SEP = String.fromCharCode(31)
const READ = `tell application "Spotify"
if it is running then
set d to (ASCII character 31)
return (player state as string) & d & (name of current track) & d & (artist of current track) & d & (artwork url of current track) & d & (shuffling as string) & d & (sound volume as string) & d & (album of current track)
else
return "not running"
end if
end tell`
async function readState() {
	const out = await osa(READ)
	if (out === null) return undefined
	if (out === 'not running' || !out.includes(SEP)) return null
	const p = out.split(SEP)
	return { state: p[0], name: p[1], artist: p[2], artUrl: p[3], shuffle: p[4] === 'true', volume: parseInt(p[5], 10) || 0, album: p[6] || '' }
}
const ACTIONS = {
	[CTRL.shuffle]: 'tell application "Spotify" to set shuffling to not shuffling',
	[CTRL.prev]: 'tell application "Spotify" to previous track',
	[CTRL.play]: 'tell application "Spotify" to playpause',
	[CTRL.next]: 'tell application "Spotify" to next track',
	9: 'tell application "Spotify"\nset v to (sound volume) - 10\nif v < 0 then set v to 0\nset sound volume to v\nend tell',
	10: 'tell application "Spotify"\nset v to (sound volume) + 10\nif v > 100 then set v to 100\nset sound volume to v\nend tell',
}

// --- device write lock + keep-alive cache ---------------------------------
let devChain = Promise.resolve()
function dev(fn) {
	const p = devChain.then(fn)
	devChain = p.catch(() => {})
	return p
}
const keyBuf = new Map()
async function setKey(index, buf) {
	keyBuf.set(index, buf)
	await dev(() => device.fillKeyBuffer(index, buf, { format: 'rgb' }))
}
async function repaintAll() {
	for (const [index, buf] of [...keyBuf]) await dev(() => device.fillKeyBuffer(index, buf, { format: 'rgb' }))
}
let KW = 118, KH = 118

// --- icons ----------------------------------------------------------------
const poly = (pts) => pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')
function iconSvg(S, kind, accent, bg = true) {
	const m = S / 2
	let g = ''
	if (kind === 'prev') {
		g = `<rect x="${S * 0.22}" y="${S * 0.3}" width="${S * 0.06}" height="${S * 0.4}" rx="2"/><polygon points="${poly([[S * 0.5, S * 0.3], [S * 0.5, S * 0.7], [S * 0.3, m]])}"/><polygon points="${poly([[S * 0.74, S * 0.3], [S * 0.74, S * 0.7], [S * 0.54, m]])}"/>`
	} else if (kind === 'next') {
		g = `<polygon points="${poly([[S * 0.26, S * 0.3], [S * 0.26, S * 0.7], [S * 0.46, m]])}"/><polygon points="${poly([[S * 0.5, S * 0.3], [S * 0.5, S * 0.7], [S * 0.7, m]])}"/><rect x="${S * 0.72}" y="${S * 0.3}" width="${S * 0.06}" height="${S * 0.4}" rx="2"/>`
	} else if (kind === 'pause') {
		g = `<rect x="${S * 0.36}" y="${S * 0.28}" width="${S * 0.1}" height="${S * 0.44}" rx="2"/><rect x="${S * 0.54}" y="${S * 0.28}" width="${S * 0.1}" height="${S * 0.44}" rx="2"/>`
	} else if (kind === 'play') {
		g = `<polygon points="${poly([[S * 0.36, S * 0.26], [S * 0.36, S * 0.74], [S * 0.74, m]])}"/>`
	} else if (kind === 'shuffle') {
		g = `<g fill="none" stroke="${accent}" stroke-width="${S * 0.05}" stroke-linecap="round"><path d="M${S * 0.2} ${S * 0.34} L${S * 0.42} ${S * 0.34} L${S * 0.62} ${S * 0.66} L${S * 0.8} ${S * 0.66}"/><path d="M${S * 0.2} ${S * 0.66} L${S * 0.42} ${S * 0.66} L${S * 0.62} ${S * 0.34} L${S * 0.8} ${S * 0.34}"/></g><polygon points="${poly([[S * 0.74, S * 0.26], [S * 0.86, S * 0.34], [S * 0.74, S * 0.42]])}"/><polygon points="${poly([[S * 0.74, S * 0.58], [S * 0.86, S * 0.66], [S * 0.74, S * 0.74]])}"/>`
	} else { // grid4 (mode)
		const sq = S * 0.18, gp = S * 0.06, x0 = S * 0.3, y0 = S * 0.3
		g = `<rect x="${x0}" y="${y0}" width="${sq}" height="${sq}" rx="2"/><rect x="${x0 + sq + gp}" y="${y0}" width="${sq}" height="${sq}" rx="2"/><rect x="${x0}" y="${y0 + sq + gp}" width="${sq}" height="${sq}" rx="2"/><rect x="${x0 + sq + gp}" y="${y0 + sq + gp}" width="${sq}" height="${sq}" rx="2"/>`
	}
	// soft shadow so glyphs read over the bright ambilight
	const filt = bg ? '' : `<filter id="d"><feDropShadow dx="0" dy="1" stdDeviation="${S * 0.03}" flood-color="#000" flood-opacity="0.85"/></filter>`
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">${filt}${bg ? '<rect width="100%" height="100%" fill="#0e0f15"/>' : ''}<g fill="${accent}"${bg ? '' : ' filter="url(#d)"'}>${g}</g></svg>`
}
function glyphSpec(index, s) {
	switch (index) {
		case CTRL.shuffle: return ['shuffle', s?.shuffle ? GREEN : WHITE]
		case CTRL.mode: return ['grid4', WHITE]
		case CTRL.prev: return ['prev', WHITE]
		case CTRL.play: return [s?.state === 'playing' ? 'pause' : 'play', WHITE]
		case CTRL.next: return ['next', WHITE]
	}
	return ['grid4', WHITE]
}

// --- text tiles -----------------------------------------------------------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function wrapText(text, maxChars) {
	const words = String(text || '').split(/\s+/).filter(Boolean)
	const lines = []
	let line = ''
	for (const w of words) {
		if ((line + ' ' + w).trim().length <= maxChars) line = (line + ' ' + w).trim()
		else { if (line) lines.push(line); line = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w }
	}
	if (line) lines.push(line)
	return lines
}
function textSvg(S, label, value, accent) {
	const fs = (value || '').length > 24 ? S * 0.11 : S * 0.135
	const maxChars = Math.max(6, Math.floor((S - 10) / (fs * 0.56)))
	let lines = wrapText(value, maxChars)
	if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].slice(0, maxChars - 1) + '…' }
	const startY = S * 0.42, lh = fs * 1.25
	const body = lines
		.map((ln, i) => `<text x="${S / 2}" y="${(startY + i * lh).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fs.toFixed(1)}" font-weight="bold" fill="#fff" filter="url(#d)">${esc(ln)}</text>`)
		.join('')
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg"><filter id="d"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.9"/></filter>
  <rect x="0" y="0" width="100%" height="5" fill="${accent}"/>
  <text x="${S / 2}" y="${S * 0.2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.095}" fill="${accent}" filter="url(#d)" letter-spacing="1">${label}</text>
  ${body}</svg>`
}

// --- ambilight background (blurred album art behind everything) ------------
const BGW = 434, BGH = 434
let BG_MINX = 23, BG_MINY = 6
let bgRaw = null // 434x434 blurred/darkened art
let curArtBuf = null
const keyByIndex = (i) => allKeys.find((k) => k.index === i)
function tileAt(raw, k) {
	const ox = k.pixelPosition.x - BG_MINX, oy = k.pixelPosition.y - BG_MINY
	const out = Buffer.allocUnsafe(KW * KH * 3)
	for (let y = 0; y < KH; y++) { const s = ((oy + y) * BGW + ox) * 3; raw.copy(out, y * KW * 3, s, s + KW * 3) }
	return out
}
function solid(r, g, b) {
	const out = Buffer.allocUnsafe(KW * KH * 3)
	for (let i = 0; i < out.length; i += 3) { out[i] = r; out[i + 1] = g; out[i + 2] = b }
	return out
}
const bgTileFor = (i) => (bgRaw ? tileAt(bgRaw, keyByIndex(i)) : solid(10, 11, 16))
// composite a transparent SVG (and optional dark scrim) over a base raw tile
async function compose(baseTile, svg, scrim = 0) {
	const layers = []
	if (scrim > 0) layers.push({ input: Buffer.from(`<svg width="${KW}" height="${KH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#000" opacity="${scrim}"/></svg>`) })
	if (svg) layers.push({ input: Buffer.from(svg) })
	return sharp(baseTile, { raw: { width: KW, height: KH, channels: 3 } }).composite(layers).removeAlpha().raw().toBuffer()
}

// --- glyph overlays (recoloured live) -------------------------------------
const artBase = {} // canvas slice (bg+art) for overlay keys, for live recolour
const glyphPos = (pos, gs) => {
	const e = Math.round(KW * 0.04), c = Math.round((KW - gs) / 2), f = KW - gs - e
	const lx = { l: e, c, r: f }, ty = { t: e, c, b: f }
	const map = { tl: ['l', 't'], tr: ['r', 't'], bl: ['l', 'b'], br: ['r', 'b'], bc: ['c', 'b'], tc: ['c', 't'], ml: ['l', 'c'], mr: ['r', 'c'], cc: ['c', 'c'] }
	const [h, v] = map[pos] || ['c', 'c']
	return { left: lx[h], top: ty[v] }
}
async function overlayGlyph(baseTile, kind, accent, pos) {
	const gs = Math.round(KW * 0.5)
	const g = await sharp(Buffer.from(iconSvg(gs, kind, accent, false))).png().toBuffer()
	return sharp(baseTile, { raw: { width: KW, height: KH, channels: 3 } }).composite([{ input: g, ...glyphPos(pos, gs) }]).removeAlpha().raw().toBuffer()
}
async function redrawGlyph(index, s) {
	const lay = LAYOUTS[artMode]
	const [kind, acc] = glyphSpec(index, s)
	if (lay.overlays?.[index] && artBase[index]) await setKey(index, await overlayGlyph(artBase[index], kind, acc, lay.overlays[index]))
	else await setKey(index, await compose(bgTileFor(index), iconSvg(KW, kind, acc, false), 0.28))
}

// --- album art load + full layout paint -----------------------------------
let lastArtUrl = null
async function updateArt(url) {
	if (!url || url === lastArtUrl) return
	lastArtUrl = url
	try {
		const res = await fetch(url)
		if (!res.ok) throw new Error(`art ${res.status}`)
		curArtBuf = Buffer.from(await res.arrayBuffer())
		bgRaw = await sharp(curArtBuf).resize(BGW, BGH, { fit: 'cover' }).blur(20).modulate({ brightness: 0.82 }).flatten().removeAlpha().raw().toBuffer()
		await paintLayout()
	} catch (e) {
		console.error('art:', e.message)
		lastArtUrl = null
	}
}
// build the 434x434 canvas = ambilight bg + the sharp album art at its position
async function buildCanvas() {
	const comps = []
	if (artMode === 'info') {
		const k4 = keyByIndex(4)
		comps.push({ input: await sharp(curArtBuf).resize(KW, KH, { fit: 'cover' }).png().toBuffer(), left: k4.pixelPosition.x - BG_MINX, top: k4.pixelPosition.y - BG_MINY })
	} else {
		const art = await sharp(curArtBuf).resize(INNER, INNER, { fit: 'cover' }).png().toBuffer()
		comps.push({ input: art, left: Math.round((BGW - INNER) / 2), top: artMode === 'top6' ? 0 : Math.round((BGH - INNER) / 2) })
	}
	return sharp(bgRaw, { raw: { width: BGW, height: BGH, channels: 3 } }).composite(comps).removeAlpha().raw().toBuffer()
}
async function paintLayout() {
	if (!cur || !bgRaw) return
	const lay = LAYOUTS[artMode]
	const canvas = await buildCanvas()
	for (const k of allKeys) {
		const i = k.index
		const slice = tileAt(canvas, k)
		if (lay.overlays?.[i]) {
			artBase[i] = slice
			const [kind, acc] = glyphSpec(i, cur)
			await setKey(i, await overlayGlyph(slice, kind, acc, lay.overlays[i]))
		} else if (lay.icons?.includes(i)) {
			const [kind, acc] = glyphSpec(i, cur)
			await setKey(i, await compose(bgTileFor(i), iconSvg(KW, kind, acc, false), 0.28))
		} else if (lay.text?.[i]) {
			await drawText(i, lay.text[i])
		} else {
			await setKey(i, slice)
		}
	}
}
async function drawText(i, field) {
	const [label, acc] = TEXT_META[field]
	await setKey(i, await compose(bgTileFor(i), textSvg(KW, label, cur[field], acc), 0.4))
}

// --- volume overlay (bottom 3 keys) ---------------------------------------
let bottomKeys = []
let VW = 434, VMINX = 0, VMINY = 0, vol = 50, volumeActive = false, revertTimer = null
function tileFromCanvas(raw, k, canvasW, minX, minY) {
	const ox = k.pixelPosition.x - minX, oy = k.pixelPosition.y - minY
	const out = Buffer.allocUnsafe(KW * KH * 3)
	for (let y = 0; y < KH; y++) { const s = ((oy + y) * canvasW + ox) * 3; raw.copy(out, y * KW * 3, s, s + KW * 3) }
	return out
}
function volumeSvg(level, W, H) {
	const tX = W * 0.2, tE = W * 0.95, tW = tE - tX, cy = H * 0.6, bh = Math.max(8, H * 0.11)
	const fw = Math.max(0, Math.min(1, level / 100)) * tW, sx = W * 0.06, sy = cy
	return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0e0f15"/>
  <rect x="${sx}" y="${sy - H * 0.09}" width="${H * 0.1}" height="${H * 0.18}" fill="${WHITE}"/>
  <polygon points="${sx + H * 0.1},${sy - H * 0.09} ${sx + H * 0.24},${sy - H * 0.22} ${sx + H * 0.24},${sy + H * 0.22} ${sx + H * 0.1},${sy + H * 0.09}" fill="${WHITE}"/>
  <rect x="${tX}" y="${cy - bh / 2}" width="${tW}" height="${bh}" rx="${bh / 2}" fill="#33343d"/>
  <rect x="${tX}" y="${cy - bh / 2}" width="${fw}" height="${bh}" rx="${bh / 2}" fill="${GREEN}"/>
  <text x="${tE}" y="${H * 0.34}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="${H * 0.24}" font-weight="bold" fill="${WHITE}">${level}</text>
</svg>`
}
async function showVolume(level) {
	volumeActive = true
	const raw = await sharp(Buffer.from(volumeSvg(level, VW, KH))).flatten().removeAlpha().raw().toBuffer()
	await Promise.all(bottomKeys.map((k) => setKey(k.index, tileFromCanvas(raw, k, VW, VMINX, VMINY))))
}
async function revertControls() {
	volumeActive = false
	for (const i of [CTRL.prev, CTRL.play, CTRL.next]) await redrawGlyph(i, cur)
}
function scheduleRevert() { clearTimeout(revertTimer); revertTimer = setTimeout(() => revertControls().catch(() => {}), 1500) }

// --- layout switching -----------------------------------------------------
async function setArtMode(mode) {
	artMode = mode
	if (cur && bgRaw) await paintLayout()
	else for (const k of allKeys) await setKey(k.index, solid(10, 11, 16))
}

// --- device + cleanup -----------------------------------------------------
async function openDevice() {
	const d = await listMXCreativeConsoleDevices()
	if (!d[0]) { console.error('No MX Creative Console connected.'); process.exit(1) }
	let dev2, lastErr
	for (let i = 0; i < 6; i++) {
		try { dev2 = await openMxCreativeConsole(d[0].path, { jpegOptions: { quality: 92 } }); break }
		catch (e) { lastErr = e; if (i === 0) console.log('Waiting for device...'); await sleep(1000) }
	}
	if (!dev2) throw new Error(`Could not open device: ${lastErr?.message || lastErr}`)
	dev2.on('error', (e) => console.error('Device error:', e))
	await dev2.clearPanel()
	await dev2.setBrightness(100)
	return dev2
}
let cleaning = false
async function cleanup(code) {
	if (cleaning) return
	cleaning = true
	const hard = setTimeout(() => process.exit(code), 1500)
	try { await device?.clearPanel() } catch {}
	try { await device?.close() } catch {}
	clearTimeout(hard)
	process.exit(code)
}
process.on('SIGINT', () => { console.log('\nStopping...'); cleanup(0) })
process.on('SIGTERM', () => cleanup(0))

// --- main loop ------------------------------------------------------------
let cur = null
let shownIdle = false
let polling = false
async function poll() {
	if (polling) return
	polling = true
	try {
		const s = await readState()
		if (s === undefined) return
		if (s === null) { if (!shownIdle) { for (const k of allKeys) await setKey(k.index, solid(10, 11, 16)); shownIdle = true; cur = null } return }
		shownIdle = false
		vol = s.volume
		const trackChanged = !cur || cur.name !== s.name || cur.artist !== s.artist || cur.album !== s.album
		const prev = cur
		cur = s
		await updateArt(s.artUrl) // recomputes ambilight + repaints on track change
		if (!volumeActive && (!prev || prev.state !== s.state)) await redrawGlyph(CTRL.play, s)
		if (!prev || prev.shuffle !== s.shuffle) await redrawGlyph(CTRL.shuffle, s)
		if (trackChanged) console.log(`♪ ${s.name} — ${s.artist}  [vol ${s.volume}]`)
	} finally {
		polling = false
	}
}

async function main() {
	device = await openDevice()
	if (process.env.MX_LAUNCHER) backCombo(device)
	allKeys = device.CONTROLS.filter((c) => c.type === 'button' && c.feedbackType === 'lcd')
	KW = allKeys[0]?.pixelSize.width || 118
	KH = allKeys[0]?.pixelSize.height || 118
	BG_MINX = Math.min(...allKeys.map((k) => k.pixelPosition.x))
	BG_MINY = Math.min(...allKeys.map((k) => k.pixelPosition.y))
	bottomKeys = allKeys.filter((k) => [CTRL.prev, CTRL.play, CTRL.next].includes(k.index))
	VMINX = Math.min(...bottomKeys.map((k) => k.pixelPosition.x))
	VMINY = Math.min(...bottomKeys.map((k) => k.pixelPosition.y))
	VW = Math.max(...bottomKeys.map((k) => k.pixelPosition.x + KW)) - VMINX

	device.on('down', async (c) => {
		if (c.type !== 'button') return
		if (c.index === CTRL.mode) { const i = MODE_ORDER.indexOf(artMode); await setArtMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]); return }
		if (c.index === 9 || c.index === 10) {
			vol = Math.max(0, Math.min(100, vol + (c.index === 10 ? 10 : -10)))
			osa(ACTIONS[c.index]); await showVolume(vol); scheduleRevert(); return
		}
		const act = ACTIONS[c.index]
		if (!act) return
		await osa(act); poll().catch((e) => console.error('poll:', e.message))
	})

	await poll()
	console.log('MX Console Spotify running (ambilight). Mode = key 2 (hero -> top6 -> info), shuffle = key 0, transport = bottom, physical buttons = volume. Ctrl+C to stop.')
	setInterval(() => poll().catch((e) => console.error('poll:', e.message)), 1000)
	setInterval(() => repaintAll().catch(() => {}), 2000)
}

main().catch(async (e) => { console.error(e.message || e); await cleanup(1) })
