// @ts-check
// Mac Vitals — live system stats on the MX Creative Keypad, with a one-press
// kill for a runaway process. Pure shell-outs, no deps beyond rendering.
//
//   node vitals.js            -> drive the console
//   node vitals.js --preview  -> write preview.png (no hardware)
//
import sharp from 'sharp'
import { exec } from 'child_process'
import { fileURLToPath } from 'url'
import { listMXCreativeConsoleDevices, openMxCreativeConsole } from '@logitech-mx-creative-console/node'
import { backCombo } from '../launcher/back-combo.mjs'

const PREVIEW = process.argv.includes('--preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd) => new Promise((res) => exec(cmd, { timeout: 8000, maxBuffer: 4 << 20 }, (e, out) => res(e ? '' : out)))
const C = { green: '#36d399', lime: '#a3e635', gold: '#ffd24a', orange: '#ff9f43', red: '#f0506e', blue: '#4ea8ff', teal: '#2dd4bf', violet: '#a78bfa', grey: '#5b5f6e' }
const KILL_DENY = ['kernel_task', 'launchd', 'WindowServer', 'mediaanalysisd', 'loginwindow', 'Activity Monitor', 'Finder', 'Dock', 'coreaudiod']

// --- collect stats --------------------------------------------------------
async function collect() {
	const [cpuRaw, memTotal, vm, df, batt, net, ps, def] = await Promise.all([
		sh('top -l 2 -n 0 -s 1'), sh('sysctl -n hw.memsize'), sh('vm_stat'), sh('df -k /'),
		sh('pmset -g batt'), sh('netstat -ibn'), sh('ps -Ao pid,%cpu,comm -r'), sh('route get default'),
	])
	const cl = cpuRaw.split('\n').filter((l) => l.includes('CPU usage'))
	const m = (cl[cl.length - 1] || '').match(/([\d.]+)% user, ([\d.]+)% sys/)
	const cpu = m ? Math.min(100, parseFloat(m[1]) + parseFloat(m[2])) : null
	const total = parseInt(memTotal) || 0
	const psz = parseInt((vm.match(/page size of (\d+)/) || [])[1]) || 16384
	const pg = (re) => parseInt((vm.match(re) || [])[1] || '0')
	const usedMem = (pg(/Pages active:\s+(\d+)/) + pg(/wired down:\s+(\d+)/) + pg(/occupied by compressor:\s+(\d+)/)) * psz
	const dl = (df.split('\n')[1] || '').split(/\s+/)
	const bm = batt.match(/(\d+)%; ?([\w ]+?);/) || batt.match(/(\d+)%; ?(\w+)/)
	const iface = (def.match(/interface:\s*(\S+)/) || [])[1] || 'en0'
	const nl = net.split('\n').find((l) => { const c = l.trim().split(/\s+/); return c[0] === iface && /Link/.test(c[2] || '') })
	const nc = nl ? nl.trim().split(/\s+/) : []
	const tline = (ps.split('\n')[1] || '').trim().match(/^(\d+)\s+([\d.]+)\s+(.*)$/)
	const top = tline ? { pid: parseInt(tline[1]), cpu: parseFloat(tline[2]), name: tline[3].split('/').pop() || tline[3] } : null
	return {
		cpu, usedMem, total, ramPct: total ? (usedMem / total) * 100 : null,
		diskPct: parseInt(dl[4]) || null, diskUsed: parseInt(dl[2]) * 1024, diskTotal: parseInt(dl[1]) * 1024,
		battPct: bm ? parseInt(bm[1]) : null, charging: /charging|charged|AC Power/i.test(batt),
		din: nc[6] ? Number(nc[6]) : 0, dout: nc[9] ? Number(nc[9]) : 0, top,
	}
}

// --- formatting -----------------------------------------------------------
const pct = (x) => x == null ? '-' : Math.round(x) + '%'
const gb = (b) => b == null ? '-' : (b / 1e9).toFixed(b >= 100e9 ? 0 : 1)
const rate = (b) => b == null ? '-' : b >= 1e6 ? (b / 1e6).toFixed(1) + 'M' : b >= 1e3 ? (b / 1e3).toFixed(0) + 'k' : Math.round(b) + 'B'
const heat = (x) => x == null ? C.grey : x < 50 ? C.green : x < 75 ? C.gold : x < 90 ? C.orange : C.red

// --- tile renderers (each one 118px key) ----------------------------------
function valueSvg(S, value, label, accent, sub) {
	const v = String(value), vs = v.length >= 7 ? S * 0.19 : v.length >= 6 ? S * 0.23 : v.length >= 4 ? S * 0.32 : S * 0.42
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1b1c2b"/><stop offset="100%" stop-color="#0d0e16"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="6" fill="${accent}"/>
  <text x="50%" y="${sub ? '52%' : '57%'}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(vs)}" font-weight="bold" fill="#fff">${v}</text>
  ${sub ? `<text x="50%" y="70%" text-anchor="middle" font-family="Helvetica" font-size="${S * 0.1}" fill="#8a8fa3">${sub}</text>` : ''}
  <text x="50%" y="86%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(S * 0.11)}" fill="${accent}" letter-spacing="1">${label}</text>
</svg>`
}
function sparkSvg(S, series, big, label, accent) {
	const top = S * 0.5, bottom = S * 0.82, left = S * 0.08, right = S * 0.92, n = Math.max(1, series.length)
	let pts = ''
	series.forEach((v, i) => { const x = left + (right - left) * (i / Math.max(1, n - 1)), y = bottom - Math.min(1, v / 100) * (bottom - top); pts += `${x.toFixed(1)},${y.toFixed(1)} ` })
	const area = pts ? `${pts}${right.toFixed(1)},${bottom} ${left.toFixed(1)},${bottom}` : ''
	return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0f1017"/>
  <text x="50%" y="14%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.1}" fill="${accent}" letter-spacing="1">CPU</text>
  <text x="50%" y="38%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${S * 0.26}" font-weight="bold" fill="#fff">${big}</text>
  ${area ? `<polygon points="${area}" fill="${accent}" opacity="0.18"/>` : ''}
  ${pts ? `<polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="${S * 0.025}" stroke-linejoin="round"/>` : ''}
  <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#2a2c3a" stroke-width="1.5"/>
</svg>`
}
const raster = (svg) => sharp(Buffer.from(svg)).flatten().removeAlpha().raw().toBuffer()
function renderTile(spec, S) {
	if (spec.t === 'spark') return raster(sparkSvg(S, spec.series, spec.big, spec.label, spec.accent))
	return raster(valueSvg(S, spec.value, spec.label, spec.accent, spec.sub))
}

// --- build the 9 tiles from data ------------------------------------------
function tiles(d, net, hist, armed) {
	const topName = d.top ? d.top.name.slice(0, 9) : '-'
	const killable = d.top && d.top.pid !== process.pid && d.top.pid > 1 && !KILL_DENY.some((k) => d.top.name.includes(k))
	return [
		{ value: pct(d.cpu), label: 'CPU', accent: heat(d.cpu) },
		{ value: pct(d.ramPct), label: 'RAM', accent: heat(d.ramPct), sub: `${gb(d.usedMem)}/${gb(d.total)}G` },
		{ value: pct(d.diskPct), label: 'DISK', accent: heat(d.diskPct), sub: `${gb(d.diskTotal - d.diskUsed)}G free` },
		{ value: d.battPct == null ? '-' : d.battPct + '%', label: d.charging ? 'BATT ⚡' : 'BATTERY', accent: d.battPct > 30 ? C.green : C.red },
		{ t: 'spark', series: hist, big: pct(d.cpu), label: 'CPU', accent: heat(d.cpu) },
		{ value: rate(net.down), label: 'NET ↓', accent: C.blue },
		{ value: rate(net.up), label: 'NET ↑', accent: C.violet },
		{ value: topName, label: d.top ? `TOP ${Math.round(d.top.cpu)}%` : 'TOP', accent: C.orange },
		armed && killable
			? { value: 'KILL?', label: topName, accent: C.red }
			: { value: '⏏', label: killable ? 'KILL TOP' : 'KILL —', accent: killable ? C.red : C.grey },
	]
}

// --- run ------------------------------------------------------------------
let prevNet = null
async function netRate(d) {
	const now = Date.now()
	let down = null, up = null
	if (prevNet) { const dt = (now - prevNet.t) / 1000; if (dt > 0) { down = Math.max(0, (d.din - prevNet.din) / dt); up = Math.max(0, (d.dout - prevNet.dout) / dt) } }
	prevNet = { din: d.din, dout: d.dout, t: now }
	return { down, up }
}

async function runPreview() {
	const d = await collect(); const net = await netRate(d)
	const hist = [20, 35, 28, 50, 42, 65, 48, d.cpu || 30]
	const S = 118, gap = 8, t = tiles(d, net, hist, false), comps = []
	for (let i = 0; i < 9; i++) { const png = await sharp(await renderTile(t[i], S), { raw: { width: S, height: S, channels: 3 } }).png().toBuffer(); comps.push({ input: png, left: (i % 3) * (S + gap), top: Math.floor(i / 3) * (S + gap) }) }
	const out = fileURLToPath(new URL('preview.png', import.meta.url))
	await sharp({ create: { width: S * 3 + gap * 2, height: S * 3 + gap * 2, channels: 3, background: '#000' } }).composite(comps).png().toFile(out)
	console.log(`CPU ${pct(d.cpu)} RAM ${pct(d.ramPct)} DISK ${pct(d.diskPct)} BATT ${d.battPct}% | top ${d.top?.name} ${d.top?.cpu}% -> ${out}`)
}

async function runDevice() {
	const devs = await listMXCreativeConsoleDevices()
	if (!devs[0]) throw new Error('No MX Creative Console connected! (try: node vitals.js --preview)')
	let device, err
	for (let i = 0; i < 6; i++) { try { device = await openMxCreativeConsole(devs[0].path); break } catch (e) { err = e; await sleep(1000) } }
	if (!device) throw new Error(`Could not open device: ${err?.message || err}`)
	device.on('error', () => {})
	if (process.env.MX_LAUNCHER) backCombo(device)
	await device.clearPanel(); await device.setBrightness(100)
	const lcd = device.CONTROLS.filter((c) => c.type === 'button' && c.feedbackType === 'lcd').sort((a, b) => a.row - b.row || a.column - b.column)

	const hist = []
	let data = null, armed = false, armAt = 0

	async function paint() {
		if (!data) return
		const net = await netRate(data)
		const t = tiles(data, net, hist, armed && Date.now() - armAt < 3000)
		for (let i = 0; i < lcd.length && i < t.length; i++) await device.fillKeyBuffer(lcd[i].index, await renderTile(t[i], lcd[i].pixelSize.width), { format: 'rgb' })
	}
	async function refresh() {
		try { data = await collect(); if (data.cpu != null) { hist.push(data.cpu); if (hist.length > 30) hist.shift() } await paint() } catch (e) { console.error('refresh:', e.message) }
	}
	device.on('down', async (c) => {
		if (c.type !== 'button') return
		if (c.index === 8 && data?.top) {
			const t = data.top, ok = t.pid !== process.pid && t.pid > 1 && !KILL_DENY.some((k) => t.name.includes(k))
			if (!ok) return
			if (armed && Date.now() - armAt < 3000) { armed = false; exec(`kill ${t.pid}`); console.log(`killed ${t.name} (${t.pid})`); setTimeout(refresh, 500) }
			else { armed = true; armAt = Date.now(); paint().catch(() => {}); setTimeout(() => { armed = false; paint().catch(() => {}) }, 3000) }
		}
	})

	await refresh()
	console.log('Mac Vitals on the console. key 8 (double-press) kills the top CPU process. Ctrl+C to exit.')
	const loop = async () => { await refresh(); setTimeout(loop, 400) }
	setTimeout(loop, 2500)
}

;(PREVIEW ? runPreview() : runDevice()).catch((e) => { console.error(e.message || e); process.exit(1) })
