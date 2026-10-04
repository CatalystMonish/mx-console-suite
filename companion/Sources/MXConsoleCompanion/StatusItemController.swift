import AppKit
import Combine
import SwiftUI

// The ▦ menubar item. AppKit NSStatusItem (not SwiftUI MenuBarExtra) so the
// pinned Claude stats can be drawn in color; the popup is the same SwiftUI
// MenuContent, hosted in a popover.
@MainActor
final class StatusItemController: NSObject {
	private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
	private let popover = NSPopover()
	private let usage: UsageStore
	private var subs = Set<AnyCancellable>()
	private var appearanceObservation: NSKeyValueObservation?

	init(state: AppState, usage: UsageStore) {
		self.usage = usage
		super.init()

		let host = NSHostingController(rootView: MenuContent().environmentObject(state).environmentObject(usage))
		host.sizingOptions = [.preferredContentSize]
		popover.contentViewController = host
		popover.behavior = .transient

		if let button = item.button {
			button.target = self
			button.action = #selector(togglePopover(_:))
			// colored styles resolve labelColor against the menubar's appearance
			appearanceObservation = button.observe(\.effectiveAppearance) { [weak self] _, _ in
				Task { @MainActor in self?.redraw() }
			}
		}
		// objectWillChange fires before the new value lands; redraw on the next turn
		usage.objectWillChange
			.receive(on: RunLoop.main)
			.sink { [weak self] in self?.redraw() }
			.store(in: &subs)
		redraw()
	}

	@objc private func togglePopover(_ sender: Any?) {
		if popover.isShown {
			popover.performClose(sender)
			return
		}
		guard let button = item.button else { return }
		usage.refreshIfStale()
		// accessory apps must activate, or the text fields won't take typing
		if #available(macOS 14, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
		popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
		popover.contentViewController?.view.window?.makeKey()
	}

	private func redraw() {
		guard let button = item.button else { return }
		MenuBarRenderer.apply(to: button, stats: usage.pinnedStats, style: usage.barStyle,
		                      warn: usage.error != nil, tooltip: tooltip())
	}

	private func tooltip() -> String {
		var lines = usage.stats.map { s -> String in
			let reset = ClaudeUsage.formatReset(s.resetsAt)
			return "\(s.label): \(s.value)" + (reset.isEmpty ? "" : " · resets \(reset)")
		}
		if let e = usage.error { lines.append(usage.isStale ? "Stale: \(e.label)" : "Claude: \(e.label)") }
		return lines.isEmpty ? "MX Console" : lines.joined(separator: "\n")
	}
}
