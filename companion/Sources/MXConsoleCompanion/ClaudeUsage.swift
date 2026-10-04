import AppKit
import Foundation

// Claude subscription usage for the menubar — a Swift port of the fetch/parse
// in claude-usage/usage.js. Same endpoint, same headers, same token lookup:
//   GET https://api.anthropic.com/api/oauth/usage
// NOTE: the endpoint is undocumented/beta (anthropic-beta: oauth-2025-04-20)
// and may change without notice; every field is decoded as optional.

// One meter: a popup row, and optionally a pinned item in the menubar.
struct UsageStat: Identifiable, Equatable {
	let id: String          // "session" | "weekly" | "model:<name>" | "credits"
	let label: String       // popup row label, e.g. "Weekly (7d)"
	let short: String       // menubar label, e.g. "7d"
	let percent: Double     // 0-100
	let value: String       // "60%", "$0/$100", "OFF"
	let resetsAt: Date?
	var dimmed = false      // e.g. extra credits switched off

	var barText: String { "\(short) \(value)" }
}

// This week's usage share by surface (Claude Code, Chats, …). Popup only.
struct BreakdownRow: Equatable {
	let name: String
	let percent: Double
}

struct UsageSnapshot: Equatable {
	var stats: [UsageStat]
	var breakdown: [BreakdownRow]
}

enum UsageError: Error, Equatable {
	case noToken, reauth, http(Int), offline, badData

	var label: String {
		switch self {
		case .noToken: "NO TOKEN"
		case .reauth: "RE-AUTH"
		case .http(let code): "HTTP \(code)"
		case .offline: "OFFLINE"
		case .badData: "BAD DATA"
		}
	}
}

enum ClaudeUsage {
	static let url = URL(string: "https://api.anthropic.com/api/oauth/usage")!

	// MARK: auth
	// config.claude.oauthToken first; then (opt-in) the Claude Code token from
	// the Keychain via /usr/bin/security — the same path usage.js uses.
	static func token() -> String? {
		let cfg = Config.load()
		if !cfg.claudeToken.isEmpty { return cfg.claudeToken }
		guard cfg.useKeychain else { return nil }
		let p = Process()
		p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
		p.arguments = ["find-generic-password", "-s", "Claude Code-credentials", "-w"]
		let pipe = Pipe()
		p.standardOutput = pipe
		p.standardError = FileHandle.nullDevice
		guard (try? p.run()) != nil else { return nil }
		let data = pipe.fileHandleForReading.readDataToEndOfFile()
		p.waitUntilExit()
		guard p.terminationStatus == 0,
		      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
		      let oauth = root["claudeAiOauth"] as? [String: Any],
		      let t = oauth["accessToken"] as? String, !t.isEmpty else { return nil }
		return t
	}

	// MARK: fetch
	static func fetch() async -> Result<UsageSnapshot, UsageError> {
		// token lookup may shell out to `security`; keep it off the main thread
		guard let token = await Task.detached(operation: { token() }).value else { return .failure(.noToken) }
		var req = URLRequest(url: url, timeoutInterval: 20)
		req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
		req.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
		req.setValue("claude-code/2.1.0", forHTTPHeaderField: "User-Agent")
		req.setValue("application/json", forHTTPHeaderField: "Content-Type")
		let data: Data, code: Int
		do {
			let (d, resp) = try await URLSession.shared.data(for: req)
			data = d
			code = (resp as? HTTPURLResponse)?.statusCode ?? 0
		} catch {
			return .failure(.offline)
		}
		if code == 401 || code == 403 { return .failure(.reauth) }
		guard (200..<300).contains(code) else { return .failure(.http(code)) }
		guard let snap = try? parse(data) else { return .failure(.badData) }
		return .success(snap)
	}

	// MARK: parse
	private struct Payload: Decodable {
		struct Window: Decodable { let utilization: Double?; let resetsAt: String? }
		struct Limit: Decodable {
			struct Scope: Decodable {
				struct Model: Decodable { let id: String?; let displayName: String? }
				let model: Model?
			}
			let kind: String?
			let percent: Double?
			let resetsAt: String?
			let scope: Scope?
		}
		struct Money: Decodable { let amountMinor: Double?; let exponent: Int? }
		struct Spend: Decodable { let used: Money?; let limit: Money?; let percent: Double?; let enabled: Bool? }
		struct Breakdown: Decodable {
			struct Row: Decodable { let displayName: String?; let percent: Double? }
			let rows: [Row]?
		}
		let fiveHour: Window?
		let sevenDay: Window?
		let sevenDaySonnet: Window?
		let sevenDayOpus: Window?
		let limits: [Limit]?
		let spend: Spend?
		let sevenDayBreakdown: Breakdown?
	}

	static func parse(_ data: Data) throws -> UsageSnapshot {
		let dec = JSONDecoder()
		dec.keyDecodingStrategy = .convertFromSnakeCase
		let p = try dec.decode(Payload.self, from: data)
		let limits = p.limits ?? []
		let limit = { (kind: String) in limits.first { $0.kind == kind } }

		func pct(_ v: Double?) -> Double { min(100, max(0, v ?? 0)) }
		func meter(_ id: String, _ label: String, _ short: String, _ v: Double?, _ reset: String?) -> UsageStat {
			let p = pct(v)
			return UsageStat(id: id, label: label, short: short, percent: p, value: "\(Int(p.rounded()))%", resetsAt: date(reset))
		}

		var stats: [UsageStat] = []
		// session + weekly: `limits[]` is the current shape; five_hour/seven_day the legacy one
		if let l = limit("session") { stats.append(meter("session", "Session (5h)", "5h", l.percent, l.resetsAt)) }
		else if let w = p.fiveHour { stats.append(meter("session", "Session (5h)", "5h", w.utilization, w.resetsAt)) }
		if let l = limit("weekly_all") { stats.append(meter("weekly", "Weekly (7d)", "7d", l.percent, l.resetsAt)) }
		else if let w = p.sevenDay { stats.append(meter("weekly", "Weekly (7d)", "7d", w.utilization, w.resetsAt)) }

		// per-model weekly caps (e.g. Fable), plus the legacy sonnet/opus fields
		var models: [UsageStat] = limits
			.filter { $0.kind == "weekly_scoped" }
			.compactMap { l in
				guard let name = l.scope?.model?.displayName, !name.isEmpty else { return nil }
				return meter("model:\(name.lowercased())", "\(name) weekly", name, l.percent, l.resetsAt)
			}
		for (name, w) in [("Sonnet", p.sevenDaySonnet), ("Opus", p.sevenDayOpus)] {
			guard let w, w.utilization != nil, !models.contains(where: { $0.id == "model:\(name.lowercased())" }) else { continue }
			models.append(meter("model:\(name.lowercased())", "\(name) weekly", name, w.utilization, w.resetsAt))
		}
		stats += models

		// extra-usage credits
		if let s = p.spend, s.limit != nil {
			let money = { (m: Payload.Money?) in (m?.amountMinor ?? 0) / pow(10, Double(m?.exponent ?? 2)) }
			let used = money(s.used), cap = money(s.limit)
			let on = s.enabled ?? true
			let percent = pct(s.percent ?? (cap > 0 ? used / cap * 100 : 0))
			stats.append(UsageStat(id: "credits", label: "Extra credits", short: "Extra", percent: percent,
			                       value: on ? "$\(Int(used.rounded()))/$\(Int(cap.rounded()))" : "OFF",
			                       resetsAt: nil, dimmed: !on))
		}

		let breakdown = (p.sevenDayBreakdown?.rows ?? []).compactMap { r -> BreakdownRow? in
			guard let name = r.displayName else { return nil }
			return BreakdownRow(name: name, percent: pct(r.percent))
		}
		return UsageSnapshot(stats: stats, breakdown: breakdown)
	}

	// The API sends both "…:59.631155+00:00" and "…:00+00:00".
	private static let isoFractional: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return f
	}()
	private static let isoPlain: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime]
		return f
	}()
	static func date(_ s: String?) -> Date? {
		guard let s else { return nil }
		return isoFractional.date(from: s) ?? isoPlain.date(from: s)
	}

	// MARK: formatting (mirrors usage.js)
	static func formatReset(_ d: Date?, now: Date = Date()) -> String {
		guard let d else { return "" }
		let secs = d.timeIntervalSince(now)
		if secs <= 0 { return "now" }
		let m = Int(secs / 60), h = m / 60, days = h / 24
		if days > 0 { return "\(days)d \(h % 24)h" }
		if h > 0 { return "\(h)h \(m % 60)m" }
		return "\(m)m"
	}

	// green -> amber -> red, same thresholds as the console tiles
	static func severityColor(_ percent: Double) -> NSColor {
		percent >= 90 ? .systemRed : percent >= 70 ? .systemOrange : .systemGreen
	}
}
