import SwiftUI

struct MenuContent: View {
	@EnvironmentObject var state: AppState

	var body: some View {
		VStack(alignment: .leading, spacing: 14) {
			HStack {
				Text("MX Console").font(.headline)
				Spacer()
				Circle().fill(state.launcherRunning ? .green : .secondary).frame(width: 9, height: 9)
				Text(state.launcherRunning ? "running" : "stopped").font(.caption).foregroundStyle(.secondary)
			}

			// --- launcher control ---
			HStack {
				if state.launcherRunning {
					Button("Stop Launcher") { state.stopLauncher() }
				} else {
					Button("Start Launcher") { state.startLauncher() }
				}
				Spacer()
				Toggle("Launch at login", isOn: Binding(
					get: { state.launchAtLogin },
					set: { state.toggleLaunchAtLogin($0) }
				)).toggleStyle(.switch).controlSize(.small)
			}

			Divider()

			// --- weather ---
			Text("Weather location").font(.subheadline).bold()
			HStack {
				TextField("City", text: $state.weatherName)
				Button("Find") { Task { await state.lookupCity() } }
			}
			HStack(spacing: 8) {
				LabeledField(label: "Lat", value: $state.lat)
				LabeledField(label: "Lon", value: $state.lon)
			}

			Divider()

			// --- claude ---
			Text("Claude OAuth token").font(.subheadline).bold()
			SecureField("sk-ant-oat01-…", text: $state.claudeToken)
			Toggle("Use Claude Code token from Keychain instead", isOn: $state.useKeychain)
				.toggleStyle(.checkbox).controlSize(.small)
			Text("Paste the OAuth token from your Claude subscription. Stored in ~/.mxconsole/config.json.")
				.font(.caption2).foregroundStyle(.secondary)

			Divider()

			// --- suite path ---
			Text("Suite folder").font(.subheadline).bold()
			TextField("/path/to/mx-console-suite", text: $state.suitePath)
				.font(.caption)

			// --- actions ---
			HStack {
				Button("Save") { state.save() }.keyboardShortcut(.defaultAction)
				Spacer()
				Button("Quit") { NSApplication.shared.terminate(nil) }
			}

			if !state.status.isEmpty {
				Text(state.status).font(.caption2).foregroundStyle(.secondary)
			}
		}
		.padding(16)
		.frame(width: 320)
	}
}

private struct LabeledField: View {
	let label: String
	@Binding var value: Double
	var body: some View {
		HStack(spacing: 4) {
			Text(label).font(.caption).foregroundStyle(.secondary)
			TextField(label, value: $value, format: .number.precision(.fractionLength(2)))
				.frame(width: 80)
		}
	}
}
