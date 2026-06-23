import Foundation

// Reads/writes the suite-wide settings file the console apps consume:
//   ~/.mxconsole/config.json  =>  { weather: {name,lat,lon}, claude: {oauthToken, useKeychain} }
// Uses JSONSerialization so partial / hand-edited files are tolerated.
enum Config {
	static var dir: URL {
		FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".mxconsole", isDirectory: true)
	}
	static var path: URL { dir.appendingPathComponent("config.json") }

	struct Values {
		var weatherName = "Berlin"
		var lat = 52.52
		var lon = 13.41
		var claudeToken = ""        // empty => not set (written as JSON null)
		var useKeychain = false
	}

	static func load() -> Values {
		var v = Values()
		guard let data = try? Data(contentsOf: path),
		      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return v }
		if let w = root["weather"] as? [String: Any] {
			v.weatherName = (w["name"] as? String) ?? v.weatherName
			v.lat = (w["lat"] as? NSNumber)?.doubleValue ?? v.lat
			v.lon = (w["lon"] as? NSNumber)?.doubleValue ?? v.lon
		}
		if let c = root["claude"] as? [String: Any] {
			v.claudeToken = (c["oauthToken"] as? String) ?? ""
			v.useKeychain = (c["useKeychain"] as? Bool) ?? false
		}
		return v
	}

	static func save(_ v: Values) throws {
		let root: [String: Any] = [
			"weather": ["name": v.weatherName, "lat": v.lat, "lon": v.lon],
			"claude": ["oauthToken": (v.claudeToken.isEmpty ? NSNull() : v.claudeToken) as Any, "useKeychain": v.useKeychain],
		]
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
		try data.write(to: path, options: .atomic)
	}
}
