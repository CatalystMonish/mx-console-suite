// Shared launcher integration. Pressing the two physical buttons (index 9 and
// 10) together exits the app cleanly so the MX Console launcher can take back
// over. Only activated when the app is started by the launcher (MX_LAUNCHER=1),
// so running an app standalone behaves exactly as before.
export function backCombo(device) {
	let t9 = 0, t10 = 0
	let firing = false
	device.on('down', (c) => {
		if (!c || c.type !== 'button') return
		const now = Date.now()
		if (c.index === 9) t9 = now
		else if (c.index === 10) t10 = now
		else return
		if (!firing && t9 && t10 && Math.abs(t9 - t10) < 600) {
			firing = true
			;(async () => {
				try { await device.clearPanel() } catch {}
				try { await device.close() } catch {}
				process.exit(0)
			})()
		}
	})
}
