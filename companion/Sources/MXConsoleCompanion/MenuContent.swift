import SwiftUI

struct MenuContent: View {
	@EnvironmentObject var state: AppState
	@EnvironmentObject var usage: UsageStore

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
				)).toggleStyle(.switch).controlSize(.small).fixedSize()
			}

			Divider()

			// --- claude usage (pinned stats show in the menubar) ---
			ClaudeUsageSection()

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
				Button("Save") {
					state.save()
					usage.refresh() // pick up a new token right away
				}.keyboardShortcut(.defaultAction)
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

// Every stat the console shows, as colored meters. The checkbox pins a stat to
// the menubar; the picker sets how pinned stats are drawn there.
private struct ClaudeUsageSection: View {
	@EnvironmentObject var usage: UsageStore

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 6) {
				Text("Claude usage").font(.subheadline).bold()
				Spacer()
				status
				Button { usage.refresh() } label: { Image(systemName: "arrow.clockwise") }
					.buttonStyle(.borderless)
					.disabled(usage.loading)
					.help("Refresh now")
			}

			if usage.stats.isEmpty {
				Text(emptyMessage).font(.caption).foregroundStyle(.secondary)
			} else {
				// re-render so reset countdowns stay current between fetches
				TimelineView(.periodic(from: .now, by: 30)) { _ in
					VStack(spacing: 6) {
						ForEach(usage.stats) { stat in
							StatRow(stat: stat, pinned: Binding(
								get: { usage.isPinned(stat.id) },
								set: { usage.setPinned(stat.id, $0) }
							))
						}
					}
				}
				if let shares = breakdownText {
					Text(shares).font(.caption2).foregroundStyle(.secondary)
				}
			}

			HStack {
				Text("Menu bar").font(.caption).foregroundStyle(.secondary)
				Picker("Menu bar", selection: $usage.barStyle) {
					ForEach(BarStyle.allCases) { Text($0.title).tag($0) }
				}
				.pickerStyle(.segmented)
				.labelsHidden()
				.controlSize(.small)
			}
		}
	}

	@ViewBuilder private var status: some View {
		if let e = usage.error {
			Text(usage.isStale ? "stale · \(e.label)" : e.label)
				.font(.caption2).foregroundStyle(usage.isStale ? .orange : .red)
		} else if let t = usage.lastUpdated {
			Text("updated \(t, style: .relative) ago").font(.caption2).foregroundStyle(.secondary)
		}
	}

	private var emptyMessage: String {
		switch usage.error {
		case .noToken: "No token. Paste one below, or enable the Keychain option."
		case .reauth: "Token expired. Paste a fresh one below."
		case .some(let e): "Couldn't load usage (\(e.label))."
		case nil: "Loading…"
		}
	}

	private var breakdownText: String? {
		let rows = (usage.snapshot?.breakdown ?? []).filter { $0.percent > 0 }
		guard !rows.isEmpty else { return nil }
		return "This week: " + rows.map { "\($0.name) \(Int($0.percent.rounded()))%" }.joined(separator: " · ")
	}
}

private struct StatRow: View {
	let stat: UsageStat
	@Binding var pinned: Bool

	var body: some View {
		HStack(spacing: 8) {
			Toggle("Show in menu bar", isOn: $pinned)
				.toggleStyle(.checkbox)
				.labelsHidden()
				.help("Show in menu bar")
			Text(stat.label).font(.caption).lineLimit(1).frame(width: 84, alignment: .leading)
			Meter(percent: stat.percent, color: stat.dimmed ? .secondary : Color(nsColor: ClaudeUsage.severityColor(stat.percent)))
			Text(stat.value).font(.caption.monospacedDigit()).bold()
				.foregroundStyle(stat.dimmed ? .secondary : .primary)
				.frame(minWidth: 34, alignment: .trailing)
			Text(ClaudeUsage.formatReset(stat.resetsAt)).font(.caption2).foregroundStyle(.secondary)
				.frame(width: 44, alignment: .trailing)
		}
	}
}

private struct Meter: View {
	let percent: Double
	let color: Color

	var body: some View {
		GeometryReader { g in
			ZStack(alignment: .leading) {
				Capsule().fill(Color.primary.opacity(0.12))
				Capsule().fill(color).frame(width: g.size.width * min(max(percent, 0), 100) / 100)
			}
		}
		.frame(height: 6)
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
