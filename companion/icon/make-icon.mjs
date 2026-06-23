// Generates the companion app icon: a rounded-square macOS icon with a 3x3 grid
// of rounded colored tiles (matching the console's 9 LCD keys). Renders an
// .iconset via sharp, then iconutil -> AppIcon.icns.
//
//   node companion/icon/make-icon.mjs
//
import sharp from 'sharp'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const S = 1024

// 9 distinct-yet-harmonious colors (warm -> cool -> violet), one per key
const COLORS = [
	'#ff6b6b', '#ffa94d', '#ffd43b',
	'#51cf66', '#20c997', '#4dabf7',
	'#5c7cfa', '#9775fa', '#f783ac',
]

// rounded-square "squircle" background, inset a touch from the canvas
const M = 96, BG = S - M * 2, BR = Math.round(BG * 0.2237)
// inner 3x3 grid
const PAD = 92, GAP = 40
const inner = BG - PAD * 2
const sq = Math.round((inner - GAP * 2) / 3)
const sr = Math.round(sq * 0.22)
const x0 = M + PAD, y0 = M + PAD

let tiles = ''
for (let i = 0; i < 9; i++) {
	const r = Math.floor(i / 3), c = i % 3
	const x = x0 + c * (sq + GAP), y = y0 + r * (sq + GAP)
	tiles += `<rect x="${x}" y="${y}" width="${sq}" height="${sq}" rx="${sr}" ry="${sr}" fill="${COLORS[i]}"/>`
}

const svg = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#23262e"/>
      <stop offset="1" stop-color="#0e1014"/>
    </linearGradient>
  </defs>
  <rect x="${M}" y="${M}" width="${BG}" height="${BG}" rx="${BR}" ry="${BR}" fill="url(#bg)"/>
  ${tiles}
</svg>`

const sizes = [
	[16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
	[32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
	[128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
	[256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
	[512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
]

const setDir = join(HERE, 'AppIcon.iconset')
rmSync(setDir, { recursive: true, force: true })
mkdirSync(setDir, { recursive: true })

const master = await sharp(Buffer.from(svg)).png().toBuffer()
for (const [px, name] of sizes) {
	await sharp(master).resize(px, px).png().toFile(join(setDir, name))
}
execFileSync('iconutil', ['-c', 'icns', setDir, '-o', join(HERE, 'AppIcon.icns')])
rmSync(setDir, { recursive: true, force: true })
console.log('wrote', join(HERE, 'AppIcon.icns'))
