import SwiftUI

@main
struct MXConsoleCompanionApp: App {
	@StateObject private var state = AppState()

	init() {
		// menubar-only agent app: no Dock icon
		NSApplication.shared.setActivationPolicy(.accessory)
	}

	var body: some Scene {
		MenuBarExtra("MX Console", systemImage: "rectangle.grid.3x3.fill") {
			MenuContent().environmentObject(state)
		}
		.menuBarExtraStyle(.window)
	}
}
