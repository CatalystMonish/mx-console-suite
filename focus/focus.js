// @ts-check
// Focus — a Pomodoro timer on the MX Creative Keypad that flips macOS Do Not
// Disturb on during focus blocks (via the Shortcuts CLI). Press to start.
//
//   node focus.js            -> drive the console
//   node focus.js --preview  -> write preview.png (no hardware)
//
// One-time DND setup (optional): in Shortcuts.app make "MX Focus On" and
// "MX Focus Off" (each a Set Focus action -> Do Not Disturb, Turn On / Off).
// Without them the timer still works; the DND tile shows "setup".
//
import sharp from 'sharp'
import { exec } from 'child_process'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { listMXCreativeConsoleDevices, openMxCreativeConsole } from '@logitech-mx-creative-console/node'
import { backCombo } from '../launcher/back-combo.mjs'

const PREVIEW = process.argv.includes('--preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd) => new Promise((res) => exec(cmd, { timeout: 6000 }, (e, out) => res(e ? null : out)))
const env = (k, d) => parseInt(process.env[k] || '', 10) || d
const DUR = { focus: env('FOCUS_MIN', 25) * 60, short: env('BREAK_MIN', 5) * 60, long: env('LONGBREAK_MIN', 15) * 60 }
const GOAL = env('FOCUS_GOAL', 8)
const C = { indigo: '#7c6cff', teal: '#2dd4bf', green: '#36d399', amber: '#f5a623', coral: '#ff7a59', grey: '#5b5f6e', violet: '#a78bfa', blue: '#4ea8ff' }

// --- persistence (sessions per day) ---------------------------------------
const STORE = join(homedir(), '.mxconsole', 'focus.json')
const todayStr = () => new Date().toISOString().slice(0, 10)
let stats = { date: todayStr(), sessions: 0, focusMin: 0 }
try { const j = JSON.parse(readFileSync(STORE, 'utf8')); if (j.date === todayStr()) stats = j } catch {}
function save() { try { mkdirSync(join(homedir(), '.mxconsole'), { recursive: true }); writeFileSync(STORE, JSON.stringify(stats)) } catch {} }

// --- DND via Shortcuts ----------------------------------------------------
let dndReady = false, dndOn = false
async function dndCheck() { const l = await sh('/usr/bin/shortcuts list'); dndReady = !!l && /MX Focus On/.test(l) && /MX Focus Off/.test(l) }
function setDnd(on) { if (!dndReady || on === dndOn) return; dndOn = on; sh(`/usr/bin/shortcuts run "MX Focus ${on ? 'On' : 'Off'}"`) }
const chime = () => exec('afplay /System/Library/Sounds/Glass.aiff')

// --- timer state machine --------------------------------------------------
let phase = 'focus', remaining = DUR.focus, running = false, cycle = 0
function start() { running = true; if (phase === 'focus') setDnd(true) }
function pause() { running = false }
function reset() { phase = 'focus'; remaining = DUR.focus; running = false; setDnd(false) }
function nextAfterFocus() { cycle++; phase = cycle % 4 === 0 ? 'long' : 'short'; remaining = DUR[phase]; setDnd(false) }
function skip() {
	if (phase === 'focus') { nextAfterFocus(); running = false } else { phase = 'focus'; remaining = DUR.focus; running = false; setDnd(false) }
}
function complete() {
	chime()
	if (phase === 'focus') { stats.sessions++; stats.focusMin += DUR.focus / 60; save(); nextAfterFocus(); running = true } // auto-start the break
	else { phase = 'focus'; remaining = DUR.focus; running = false; setDnd(false) } // wait for user to start next focus
}
function tick() { if (running && --remaining <= 0) complete() }

const PHASE_LABEL = { focus: 'FOCUS', short: 'BREAK', long: 'LONG BREAK' }
const phaseAccent = () => (phase === 'focus' ? C.indigo : C.teal)

// --- renderers ------------------------------------------------------------
function valueSvg(S, value, label, accent) {
	const v = String(value), vs = v.length >= 6 ? S * 0.22 : v.length >= 4 ? S * 0.32 : S * 0.44
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1b1c2b"/><stop offset="100%" stop-color="#0d0e16"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="6" fill="${accent}"/>
  <text x="50%" y="57%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(vs)}" font-weight="bold" fill="#fff">${v}</text>
  <text x="50%" y="85%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(S * 0.11)}" fill="${accent}" letter-spacing="1">${label}</text>
</svg>`
}
const arc = (cx, cy, r, a0, a1) => { const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}` }
function ringSvg(S) {
	const cx = S / 2, cy = S * 0.52, r = S * 0.33, total = DUR[phase], p = Math.max(0, Math.min(1, remaining / total)), acc = phaseAccent()
	const mm = String(Math.floor(remaining / 60)).padStart(2, '0'), ss = String(Math.floor(remaining % 60)).padStart(2, '0')
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0f1017"/>
  <text x="50%" y="15%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.095}" fill="${acc}" letter-spacing="1">${PHASE_LABEL[phase]}</text>
  <path d="${arc(cx, cy, r, 135, 405)}" fill="none" stroke="#2a2c3a" stroke-width="${S * 0.08}" stroke-linecap="round"/>
  <path d="${arc(cx, cy, r, 135, 135 + 270 * p)}" fill="none" stroke="${acc}" stroke-width="${S * 0.08}" stroke-linecap="round"/>
  <text x="50%" y="57%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.26}" font-weight="bold" fill="#fff">${mm}:${ss}</text>
  <text x="50%" y="74%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" fill="#8a8fa3">${running ? '▶ running' : '⏸ paused'}</text>
</svg>`
}
const raster = (svg) => sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
function tileSpec(i) {
	switch (i) {
		case 0: return { value: stats.sessions, label: 'SESSIONS', accent: C.amber }
		case 1: return { value: '+5', label: 'MIN', accent: C.blue }
		case 2: return { value: stats.focusMin + 'm', label: 'FOCUSED', accent: C.teal }
		case 3: return { value: running ? '⏸' : '▶', label: running ? 'PAUSE' : 'START', accent: running ? C.amber : C.green }
		case 4: return { ring: true }
		case 5: return { value: '⏭', label: 'SKIP', accent: C.violet }
		case 6: return { value: '⟲', label: 'RESET', accent: C.coral }
		case 7: return dndReady ? { value: dndOn ? '●' : '○', label: dndOn ? 'DND ON' : 'DND OFF', accent: dndOn ? C.indigo : C.grey } : { value: '⚙', label: 'DND setup', accent: C.grey }
		case 8: return { value: `${stats.sessions}/${GOAL}`, label: 'GOAL', accent: C.green }
	}
}
const render = (i, S) => tileSpec(i).ring ? raster(ringSvg(S)) : raster(valueSvg(S, tileSpec(i).value, tileSpec(i).label, tileSpec(i).accent))

// --- run ------------------------------------------------------------------
async function runPreview() {
	await dndCheck()
	const S = 118, gap = 8, comps = []
	for (let i = 0; i < 9; i++) { const png = await sharp(await render(i, S), { raw: { width: S, height: S, channels: 3 } }).png().toBuffer(); comps.push({ input: png, left: (i % 3) * (S + gap), top: Math.floor(i / 3) * (S + gap) }) }
	const out = fileURLToPath(new URL('preview.png', import.meta.url))
	await sharp({ create: { width: S * 3 + gap * 2, height: S * 3 + gap * 2, channels: 3, background: '#000' } }).composite(comps).png().toFile(out)
	console.log(`focus ${DUR.focus / 60}m / break ${DUR.short / 60}m · DND ${dndReady ? 'ready' : 'setup needed'} · today ${stats.sessions} sessions -> ${out}`)
}

async function runDevice() {
	const devs = await listMXCreativeConsoleDevices()
	if (!devs[0]) throw new Error('No MX Creative Console connected! (try: node focus.js --preview)')
	let device, err
	for (let i = 0; i < 6; i++) { try { device = await openMxCreativeConsole(devs[0].path); break } catch (e) { err = e; await sleep(1000) } }
	if (!device) throw new Error(`Could not open device: ${err?.message || err}`)
	device.on('error', () => {})
	if (process.env.MX_LAUNCHER) backCombo(device)
	await device.clearPanel(); await device.setBrightness(100)
	await dndCheck()
	const lcd = device.CONTROLS.filter((c) => c.type === 'button' && c.feedbackType === 'lcd').sort((a, b) => a.row - b.row || a.column - b.column)
	const keyAt = (idx) => lcd.find((k) => k.index === idx)

	async function paintKey(idx) { const k = keyAt(idx); if (k) await device.fillKeyBuffer(k.index, await render(idx, k.pixelSize.width), { format: 'rgb' }) }
	async function paintAll() { for (let i = 0; i < 9; i++) await paintKey(i) }

	device.on('down', async (c) => {
		if (c.type !== 'button') return
		if (c.index === 3) running ? pause() : start()
		else if (c.index === 5) skip()
		else if (c.index === 1) remaining += 300
		else if (c.index === 6) reset()
		else if (c.index === 7 && dndReady) setDnd(!dndOn)
		else return
		paintAll().catch(() => {})
	})

	await paintAll()
	console.log(`Focus on the console. key3 start/pause · key5 skip · key1 +5m · key6 reset · key7 DND. Ctrl+C to exit.`)
	// 1s tick: advance timer, repaint the ring (and everything on phase change)
	let lastPhase = phase, lastRunning = running, lastSessions = stats.sessions
	setInterval(() => {
		tick()
		const changed = phase !== lastPhase || running !== lastRunning || stats.sessions !== lastSessions
		lastPhase = phase; lastRunning = running; lastSessions = stats.sessions
		;(changed ? paintAll() : paintKey(4)).catch(() => {})
	}, 1000)
}

;(PREVIEW ? runPreview() : runDevice()).catch((e) => { console.error(e.message || e); process.exit(1) })
