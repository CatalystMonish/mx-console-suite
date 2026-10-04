import AppKit

// Draws the status item. With nothing pinned it's the ▦ icon; once any stat is
// pinned, the stats replace the icon, in the chosen style. Colored styles use
// non-template content, so neutral parts use plain colors picked for the
// menubar's light/dark appearance (see Ink).
@MainActor
enum MenuBarRenderer {
	// Text / Color styles use the same 11pt size as the Meter+% values
	private static let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
	private static let boldFont = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)

	// Neutral colors for the drawn (non-template) styles. Semantic colors like
	// secondaryLabelColor resolve to vibrancy-blend values in the live menubar and
	// come out dark in a plain image, so pick plain colors for its light/dark.
	private struct Ink {
		let primary: NSColor, secondary: NSColor, track: NSColor
		init(_ appearance: NSAppearance) {
			let dark = [.darkAqua, .vibrantDark].contains(appearance.bestMatch(from: [.aqua, .darkAqua, .vibrantLight, .vibrantDark]))
			let base: NSColor = dark ? .white : .black
			primary = base.withAlphaComponent(dark ? 1 : 0.85)
			secondary = base.withAlphaComponent(dark ? 0.6 : 0.5)
			track = base.withAlphaComponent(dark ? 0.25 : 0.2)
		}
	}

	// ▦: a 3x3 grid of squares with slightly rounded corners. Template image, so
	// the menubar tints it.
	private static let icon: NSImage = {
		let cell: CGFloat = 4, gap: CGFloat = 1.5, radius: CGFloat = 1
		let side = cell * 3 + gap * 2
		let img = NSImage(size: NSSize(width: side, height: side), flipped: false) { _ in
			NSColor.black.setFill()
			for row in 0..<3 {
				for col in 0..<3 {
					let r = NSRect(x: CGFloat(col) * (cell + gap), y: CGFloat(row) * (cell + gap), width: cell, height: cell)
					NSBezierPath(roundedRect: r, xRadius: radius, yRadius: radius).fill()
				}
			}
			return true
		}
		img.isTemplate = true
		img.accessibilityDescription = "MX Console"
		return img
	}()

	static func apply(to button: NSStatusBarButton, stats: [UsageStat], style: BarStyle, warn: Bool, tooltip: String) {
		button.toolTip = tooltip

		if stats.isEmpty {
			button.image = icon
			button.imagePosition = warn ? .imageLeading : .imageOnly
			button.attributedTitle = warn ? warning() : NSAttributedString()
			return
		}
		switch style {
		case .text:
			button.image = nil
			button.imagePosition = .noImage
			button.font = font
			button.title = stats.map(\.barText).joined(separator: " · ") + (warn ? " !" : "")
		case .coloredText:
			button.image = nil
			button.imagePosition = .noImage
			button.attributedTitle = coloredTitle(stats, warn: warn)
		case .meter, .meterText:
			button.attributedTitle = NSAttributedString()
			button.image = meterImage(stats, showValue: style == .meterText, warn: warn,
			                          appearance: button.effectiveAppearance, description: tooltip)
			button.imagePosition = .imageOnly
		}
	}

	private static func valueColor(_ s: UsageStat, dimmed: NSColor = .secondaryLabelColor) -> NSColor {
		s.dimmed ? dimmed : ClaudeUsage.severityColor(s.percent)
	}

	private static func warning() -> NSAttributedString {
		NSAttributedString(string: " !", attributes: [.font: boldFont, .foregroundColor: NSColor.systemOrange])
	}

	// "5h 0% · 7d 60%" with each value in its severity color
	private static func coloredTitle(_ stats: [UsageStat], warn: Bool) -> NSAttributedString {
		let s = NSMutableAttributedString()
		for (i, st) in stats.enumerated() {
			if i > 0 { s.append(NSAttributedString(string: " · ", attributes: [.font: font, .foregroundColor: NSColor.secondaryLabelColor])) }
			s.append(NSAttributedString(string: st.short + " ", attributes: [.font: font, .foregroundColor: NSColor.labelColor]))
			s.append(NSAttributedString(string: st.value, attributes: [.font: boldFont, .foregroundColor: valueColor(st)]))
		}
		if warn { s.append(warning()) }
		return s
	}

	// One mini meter per stat: tiny label over a colored bar, optionally
	// followed by the value.
	private static func meterImage(_ stats: [UsageStat], showValue: Bool, warn: Bool,
	                               appearance: NSAppearance, description: String) -> NSImage {
		let labelFont = NSFont.systemFont(ofSize: 8, weight: .semibold)
		let valueFont = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
		let h: CGFloat = 18, barW: CGFloat = 22, barH: CGFloat = 4, gap: CGFloat = 7

		struct Cell { let stat: UsageStat; let x: CGFloat; let w: CGFloat }
		var cells: [Cell] = []
		var x: CGFloat = 0
		for st in stats {
			let lw = ceil((st.short as NSString).size(withAttributes: [.font: labelFont]).width)
			let w = max(barW, lw)
			cells.append(Cell(stat: st, x: x, w: w))
			let vw = showValue ? ceil((st.value as NSString).size(withAttributes: [.font: valueFont]).width) + 3 : 0
			x += w + vw + gap
		}
		let warnText = NSAttributedString(string: "!", attributes: [.font: NSFont.boldSystemFont(ofSize: 12), .foregroundColor: NSColor.systemOrange])
		let width = x - gap + (warn ? warnText.size().width + 4 : 0)

		let ink = Ink(appearance)
		let img = NSImage(size: NSSize(width: ceil(width), height: h), flipped: false) { _ in
			appearance.performAsCurrentDrawingAppearance {
				for c in cells {
					let label = NSAttributedString(string: c.stat.short, attributes: [.font: labelFont, .foregroundColor: ink.primary])
					let ls = label.size()
					label.draw(at: NSPoint(x: c.x + (c.w - ls.width) / 2, y: h - ls.height + 1))

					let track = NSRect(x: c.x, y: 2, width: c.w, height: barH)
					ink.track.setFill()
					NSBezierPath(roundedRect: track, xRadius: barH / 2, yRadius: barH / 2).fill()
					if c.stat.percent > 0 {
						var fill = track
						fill.size.width = max(barH, c.w * c.stat.percent / 100)
						valueColor(c.stat, dimmed: ink.secondary).setFill()
						NSBezierPath(roundedRect: fill, xRadius: barH / 2, yRadius: barH / 2).fill()
					}
					if showValue {
						let v = NSAttributedString(string: c.stat.value, attributes: [.font: valueFont, .foregroundColor: ink.primary])
						v.draw(at: NSPoint(x: c.x + c.w + 3, y: (h - v.size().height) / 2))
					}
				}
				if warn { warnText.draw(at: NSPoint(x: width - warnText.size().width, y: (h - warnText.size().height) / 2)) }
			}
			return true
		}
		img.isTemplate = false
		img.accessibilityDescription = description
		return img
	}
}
