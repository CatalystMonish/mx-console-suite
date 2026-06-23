import Foundation
import SwiftUI
import ServiceManagement

@MainActor
final class AppState: ObservableObject {
	// settings (mirrors ~/.mxconsole/config.json)
	@Published var weatherName = "Berlin"
	@Published var lat = 52.52
	@Published var lon = 13.41
	@Published var claudeToken = ""
	@Published var useKeychain = false

	// companion-only prefs (stored in UserDefaults, not in config.json)
	@Published var suitePath: String {
		didSet { UserDefaults.standard.set(suitePath, forKey: "suitePath") }
	}

	// runtime
	@Published var launcherRunning = false
	@Published var launchAtLogin = false
	@Published var status = ""

	private var process: Process?

	init() {
		let defaultSuite = FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent("Documents/Production/mx-console-suite").path
		suitePath = UserDefaults.standard.string(forKey: "suitePath") ?? defaultSuite
		let v = Config.load()
		weatherName = v.weatherName; lat = v.lat; lon = v.lon
		claudeToken = v.claudeToken; useKeychain = v.useKeychain
		launchAtLogin = (SMAppService.mainApp.status == .enabled)
	}

	// MARK: settings
	func save() {
		do {
			try Config.save(.init(weatherName: weatherName, lat: lat, lon: lon, claudeToken: claudeToken, useKeychain: useKeychain))
			status = "Saved."
		} catch {
			status = "Save failed: \(error.localizedDescription)"
		}
	}

	// Resolve a city name to coordinates via Open-Meteo's free geocoding API.
	func lookupCity() async {
		let q = weatherName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
		guard !q.isEmpty,
		      let url = URL(string: "https://geocoding-api.open-meteo.com/v1/search?name=\(q)&count=1") else { return }
		do {
			let (data, _) = try await URLSession.shared.data(from: url)
			struct Resp: Decodable { struct R: Decodable { let latitude: Double; let longitude: Double; let name: String }; let results: [R]? }
			if let r = try JSONDecoder().decode(Resp.self, from: data).results?.first {
				lat = r.latitude; lon = r.longitude; weatherName = r.name
				status = "Found \(r.name): \(String(format: "%.2f, %.2f", r.latitude, r.longitude))"
			} else {
				status = "City not found."
			}
		} catch {
			status = "Lookup failed: \(error.localizedDescription)"
		}
	}

	// MARK: launcher process
	// Find the user's `node`. GUI apps launched by Finder get a minimal PATH that
	// misses nvm/asdf/fnm/Homebrew, so ask the login shell, then fall back to
	// common static locations.
	private func resolveNode() -> String? {
		let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
		let p = Process()
		p.executableURL = URL(fileURLWithPath: shell)
		p.arguments = ["-lc", "command -v node"]
		let pipe = Pipe()
		p.standardOutput = pipe
		p.standardError = FileHandle.nullDevice
		if let _ = try? p.run() {
			p.waitUntilExit()
			let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
				.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			if !out.isEmpty, FileManager.default.isExecutableFile(atPath: out) { return out }
		}
		for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] where FileManager.default.isExecutableFile(atPath: c) { return c }
		return nil
	}

	// A self-contained build ships its own node + suite inside the .app under
	// Contents/Resources. Prefer those; otherwise fall back to the user's node
	// and the configured suite folder (dev mode).
	private var bundledNode: String? {
		guard let p = Bundle.main.resourceURL?.appendingPathComponent("runtime/node").path,
		      FileManager.default.isExecutableFile(atPath: p) else { return nil }
		return p
	}
	private var bundledSuite: String? {
		guard let p = Bundle.main.resourceURL?.appendingPathComponent("suite").path,
		      FileManager.default.fileExists(atPath: p + "/launcher/launcher.js") else { return nil }
		return p
	}

	func startLauncher() {
		guard process == nil else { return }
		let suite = bundledSuite ?? suitePath
		let script = suite + "/launcher/launcher.js"
		guard FileManager.default.fileExists(atPath: script) else { status = "launcher.js not found at \(script)"; return }
		guard let node = bundledNode ?? resolveNode() else { status = "node not found — is Node.js installed?"; return }
		let bundled = (bundledNode != nil)

		let p = Process()
		p.executableURL = URL(fileURLWithPath: node)
		p.arguments = [script]
		var env = ProcessInfo.processInfo.environment
		// node's own dir + Homebrew + the standard system dirs (so osascript/afplay/etc resolve)
		env["PATH"] = "\((node as NSString).deletingLastPathComponent):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
		p.environment = env

		// log to ~/.mxconsole/launcher.log so failures are visible
		let logURL = Config.dir.appendingPathComponent("launcher.log")
		try? FileManager.default.createDirectory(at: Config.dir, withIntermediateDirectories: true)
		FileManager.default.createFile(atPath: logURL.path, contents: nil)
		if let log = try? FileHandle(forWritingTo: logURL) {
			p.standardOutput = log
			p.standardError = log
		}
		p.terminationHandler = { [weak self] proc in
			let code = proc.terminationStatus
			Task { @MainActor in
				self?.launcherRunning = false
				self?.process = nil
				if code != 0 { self?.status = "Launcher exited (code \(code)) — see ~/.mxconsole/launcher.log" }
			}
		}
		do {
			try p.run()
			process = p
			launcherRunning = true
			status = bundled ? "Launcher started (bundled runtime)." : "Launcher started (system node)."
		} catch {
			status = "Start failed: \(error.localizedDescription)"
		}
	}

	func stopLauncher() {
		process?.terminate()   // SIGTERM -> launcher clears the panel and exits
		process = nil
		launcherRunning = false
		status = "Launcher stopped."
	}

	// MARK: launch at login
	func toggleLaunchAtLogin(_ on: Bool) {
		do {
			if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
			launchAtLogin = (SMAppService.mainApp.status == .enabled)
		} catch {
			status = "Login item: \(error.localizedDescription)"
			launchAtLogin = (SMAppService.mainApp.status == .enabled)
		}
	}
}
