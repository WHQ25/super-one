/**
 * SuperOne Computer Use helper (P2).
 *
 * Separate signed .app so TCC (Accessibility + Screen Recording) is not tied to
 * Electron's main process identity. Speaks line-delimited JSON over a user-only
 * Unix domain socket. Policy (allowlist) is applied by the Electron main process;
 * this helper only receives already-resolved grantedBundleIds for capture exclusion.
 *
 * Capture policy and ScreenCaptureKit details live in Capture.swift.
 */

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Protocol

struct HelperRequest: Decodable {
    let id: String
    let method: String
    let params: [String: AnyCodable]?
}

struct HelperErrorBody: Encodable {
    let code: String
    let message: String
}

struct HelperResponse: Encodable {
    let id: String
    let ok: Bool
    let result: AnyEncodable?
    let error: HelperErrorBody?

    static func success(id: String, result: Any) -> HelperResponse {
        HelperResponse(id: id, ok: true, result: AnyEncodable(result), error: nil)
    }

    static func failure(id: String, code: String, message: String) -> HelperResponse {
        HelperResponse(id: id, ok: false, result: nil, error: HelperErrorBody(code: code, message: message))
    }
}

/// Minimal type-erased JSON values for decoding/encoding dynamic params/results.
struct AnyCodable: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull(); return }
        if let v = try? c.decode(Bool.self) { value = v; return }
        if let v = try? c.decode(Int.self) { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode([String: AnyCodable].self) {
            value = v.mapValues { $0.value }
            return
        }
        if let v = try? c.decode([AnyCodable].self) {
            value = v.map { $0.value }
            return
        }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON")
    }

    static func string(_ dict: [String: Any]?, _ key: String) -> String? {
        dict?[key] as? String
    }

    static func stringArray(_ dict: [String: Any]?, _ key: String) -> [String] {
        (dict?[key] as? [Any])?.compactMap { $0 as? String } ?? []
    }

    static func double(_ dict: [String: Any]?, _ key: String) -> Double? {
        if let d = dict?[key] as? Double { return d }
        if let i = dict?[key] as? Int { return Double(i) }
        return nil
    }

    static func int(_ dict: [String: Any]?, _ key: String) -> Int? {
        if let i = dict?[key] as? Int { return i }
        if let d = dict?[key] as? Double { return Int(d) }
        return nil
    }

    static func doubleArray(_ dict: [String: Any]?, _ key: String) -> [Double]? {
        guard let arr = dict?[key] as? [Any] else { return nil }
        return arr.compactMap {
            if let d = $0 as? Double { return d }
            if let i = $0 as? Int { return Double(i) }
            return nil
        }
    }
}

struct AnyEncodable: Encodable {
    let value: Any
    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try c.encodeNil()
        case let v as Bool:
            try c.encode(v)
        case let v as Int:
            try c.encode(v)
        case let v as Double:
            try c.encode(v)
        case let v as String:
            try c.encode(v)
        case let v as [String: Any]:
            try c.encode(v.mapValues { AnyEncodable($0) })
        case let v as [Any]:
            try c.encode(v.map { AnyEncodable($0) })
        default:
            try c.encode(String(describing: value))
        }
    }
}

// MARK: - Permissions
//
// Match Open Computer Use (Permissions.swift):
// - Check Screen Recording with CGPreflightScreenCaptureAccess() — does NOT prompt.
// - Never use SCShareableContent just to probe permission (that re-triggers the dialog).
// - After the user grants Screen Recording in System Settings, the *running* process
//   still has the old denied state until it fully quits and relaunches (OCU kills + restarts).

func axTrusted() -> Bool {
    AXIsProcessTrusted()
}

/// Non-prompting screen-recording check (same primitive as Open Computer Use).
func screenRecordingTrusted() -> Bool {
    CGPreflightScreenCaptureAccess()
}

/// One-shot system prompt for Screen Recording. Returns current preflight result.
func requestScreenRecordingAccess() -> Bool {
    _ = CGRequestScreenCaptureAccess()
    return CGPreflightScreenCaptureAccess()
}

func doctor() -> [String: Any] {
    [
        "accessibility": axTrusted() ? "granted" : "missing",
        "screenRecording": screenRecordingTrusted() ? "granted" : "missing",
        "bundleId": Bundle.main.bundleIdentifier ?? "unknown",
        "bundlePath": Bundle.main.bundleURL.path,
        "pid": ProcessInfo.processInfo.processIdentifier,
        // Hint for clients: Screen Recording grants only apply after full process restart.
        "screenRecordingNeedsRelaunch": !screenRecordingTrusted(),
    ]
}

// MARK: - Apps

func listRunningApps() -> [[String: Any]] {
    let front = NSWorkspace.shared.frontmostApplication
    return NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .compactMap { app -> [String: Any]? in
            guard let name = app.localizedName else { return nil }
            return [
                "app": name,
                "bundleId": app.bundleIdentifier ?? "",
                "pid": app.processIdentifier,
                "frontmost": app.processIdentifier == front?.processIdentifier,
            ]
        }
}

func frontmostApp() -> [String: Any]? {
    guard let app = NSWorkspace.shared.frontmostApplication,
          let name = app.localizedName else { return nil }
    return [
        "app": name,
        "bundleId": app.bundleIdentifier ?? "",
        "pid": app.processIdentifier,
        "frontmost": true,
    ]
}

func listWindows() -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    let selfPid = Int(ProcessInfo.processInfo.processIdentifier)
    return info.compactMap { w -> [String: Any]? in
        let layer = w[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0 else { return nil }
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let title = w[kCGWindowName as String] as? String ?? ""
        let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
        // Never expose our own overlay / helper chrome as an operable root.
        if pid == selfPid { return nil }
        let bounds = w[kCGWindowBounds as String] as? [String: Any]
        let x = bounds?["X"] as? CGFloat ?? 0
        let y = bounds?["Y"] as? CGFloat ?? 0
        let width = bounds?["Width"] as? CGFloat ?? 0
        let height = bounds?["Height"] as? CGFloat ?? 0
        let windowId = w[kCGWindowNumber as String] as? Int ?? 0
        let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""
        let axMetadata = axTrusted() && windowId > 0
            ? try? resolveAxWindow(pid: pid_t(pid), windowId: windowId, windowTitle: title)
            : nil
        let classification = axMetadata.map(classifyAxWindow)
        return [
            "app": owner,
            "bundleId": bundleId,
            "pid": pid,
            "title": title,
            "bounds": ["x": Double(x), "y": Double(y), "width": Double(width), "height": Double(height)],
            "focused": axMetadata?.focused ?? false,
            "visible": true,
            "minimized": false,
            "modal": classification?.modal ?? false,
            "kind": classification?.kind ?? "window",
            "resourceKey": "pid:\(pid)",
            "windowId": windowId,
            "windowLayer": layer,
        ]
    }
}

/// Bring target app into a usable (non-hidden) state without stealing the user's frontmost app.
/// Set `activate=true` only when the agent explicitly needs key-window frontmost (rare / global HID).
func focusApp(query: String, activate: Bool = false) throws {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    guard let match = apps.first(where: {
        $0.bundleIdentifier == query
            || $0.localizedName?.caseInsensitiveCompare(query) == .orderedSame
    }) else {
        throw HelperError(code: "APP_NOT_FOUND", message: "App not found: \(query)")
    }
    if match.isHidden {
        match.unhide()
    }
    if activate {
        match.activate()
    }
}

/// Launch without frontmost activation so Computer Use can work in the background.
func launchApp(query: String, activate: Bool = false) throws {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query) {
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = activate
        NSWorkspace.shared.openApplication(at: url, configuration: cfg)
        return
    }
    // Fall back to name
    let cfg = NSWorkspace.OpenConfiguration()
    cfg.activates = activate
    if let url = NSWorkspace.shared.urlForApplication(toOpen: URL(fileURLWithPath: "/Applications/\(query).app")) {
        NSWorkspace.shared.openApplication(at: url, configuration: cfg)
        return
    }
    // last resort: open -a style (always activates via LaunchServices)
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    task.arguments = activate ? ["-a", query] : ["-a", query, "-g"]
    try task.run()
}

func resolvePid(bundleId: String?, pid: Int?) -> pid_t? {
    if let pid, pid > 0 { return pid_t(pid) }
    guard let bundleId, !bundleId.isEmpty else { return nil }
    return NSWorkspace.shared.runningApplications
        .first(where: { $0.bundleIdentifier == bundleId })?
        .processIdentifier
}

// MARK: - Input

struct HelperError: Error {
    let code: String
    let message: String
}

// MARK: - Overlay helpers (params from Electron)

/// Optional window bounds + app name on act payloads for the visual ring.
func maybeShowOverlayFromParams(
    _ params: [String: Any],
    cursor: CGPoint?,
    pulseCursor: Bool,
    pulseRing: Bool
) {
    // Allow host to disable per-call without a separate RPC.
    if let enabled = params["visualIndicators"] as? Bool, !enabled {
        return
    }
    guard let bx = AnyCodable.double(params, "windowX"),
          let by = AnyCodable.double(params, "windowY"),
          let bw = AnyCodable.double(params, "windowWidth"),
          let bh = AnyCodable.double(params, "windowHeight"),
          bw > 1, bh > 1 else {
        // Cursor-only if we have a point.
        if let cursor {
            AgentOverlayController.shared.moveCursor(quartz: cursor, pulse: pulseCursor)
        }
        return
    }
    let app = AnyCodable.string(params, "windowApp") ?? ""
    let bundleId = AnyCodable.string(params, "targetBundleId")
        ?? AnyCodable.string(params, "windowBundleId")
    let windowId = AnyCodable.int(params, "windowId")
    let windowLayer = AnyCodable.int(params, "windowLayer")
    let targetPid = AnyCodable.int(params, "targetPid")
    // Menu-bar chip + optional virtual cursor at the action point.
    AgentOverlayController.shared.showActive(
        appName: app,
        bundleId: bundleId,
        windowId: windowId,
        windowLayer: windowLayer
    )
    AgentOverlayController.shared.setWatchedTarget(bundleId: bundleId, pid: targetPid)
    if let cursor {
        AgentOverlayController.shared.moveCursor(quartz: cursor, pulse: pulseCursor || pulseRing)
    }
    _ = bx
    _ = by
    _ = bw
    _ = bh
}

// MARK: - Dispatch

func handle(request: HelperRequest) async -> HelperResponse {
    let params = request.params?.mapValues { $0.value } ?? [:]
    do {
        switch request.method {
        case "ping":
            return .success(id: request.id, result: ["pong": true])
        case "doctor":
            return .success(id: request.id, result: doctor())
        case "request_screen_recording":
            // One-shot TCC prompt; client should restart helper after user grants.
            let granted = requestScreenRecordingAccess()
            return .success(id: request.id, result: [
                "screenRecording": granted ? "granted" : "missing",
                "needsRelaunch": !granted,
            ])
        case "open_permission_onboarding":
            // OCU-style drag-to-Settings UX (runs on main thread).
            let already = axTrusted() && screenRecordingTrusted()
            if already {
                return .success(id: request.id, result: [
                    "presented": false,
                    "reason": "already_granted",
                    "accessibility": "granted",
                    "screenRecording": "granted",
                ])
            }
            DispatchQueue.main.async {
                PermissionOnboarding.present()
            }
            return .success(id: request.id, result: [
                "presented": true,
                "accessibility": axTrusted() ? "granted" : "missing",
                "screenRecording": screenRecordingTrusted() ? "granted" : "missing",
            ])
        case "list_apps":
            return .success(id: request.id, result: ["apps": listRunningApps()])
        case "frontmost":
            return .success(id: request.id, result: frontmostApp() as Any)
        case "list_windows":
            return .success(id: request.id, result: ["windows": listWindows()])
        case "ax_tree":
            guard let pid = AnyCodable.int(params, "pid").map({ pid_t($0) }) else {
                throw HelperError(code: "INVALID", message: "pid required")
            }
            let maxNodes = AnyCodable.int(params, "maxNodes") ?? 400
            let maxDepth = AnyCodable.int(params, "maxDepth") ?? 24
            let captureWidth = AnyCodable.double(params, "captureWidth")
            let captureHeight = AnyCodable.double(params, "captureHeight")
            let captureX = AnyCodable.double(params, "captureX")
            let captureY = AnyCodable.double(params, "captureY")
            let captureSourceWidth = AnyCodable.double(params, "captureSourceWidth")
            let captureSourceHeight = AnyCodable.double(params, "captureSourceHeight")
            let windowTitle = AnyCodable.string(params, "windowTitle")
            let windowId = AnyCodable.int(params, "windowId")
            let result = try axTreeSnapshot(
                pid: pid,
                maxNodes: maxNodes,
                maxDepth: maxDepth,
                captureWidth: captureWidth,
                captureHeight: captureHeight,
                captureX: captureX,
                captureY: captureY,
                captureSourceWidth: captureSourceWidth,
                captureSourceHeight: captureSourceHeight,
                windowTitle: windowTitle,
                windowId: windowId
            )
            return .success(id: request.id, result: result)
        case "ax_action":
            guard let pid = AnyCodable.int(params, "pid").map({ pid_t($0) }) else {
                throw HelperError(code: "INVALID", message: "pid required")
            }
            guard let index = AnyCodable.int(params, "index") else {
                throw HelperError(code: "INVALID", message: "index required")
            }
            guard let action = AnyCodable.string(params, "action") else {
                throw HelperError(code: "INVALID", message: "action required")
            }
            let value = AnyCodable.string(params, "value")
            let windowTitle = AnyCodable.string(params, "windowTitle")
            let windowId = AnyCodable.int(params, "windowId")
            let expectedBoundsValues = AnyCodable.doubleArray(params, "expectedBounds")
            let expectedBounds: CGRect? = {
                guard let values = expectedBoundsValues, values.count == 4 else { return nil }
                return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
            }()
            let coordinateTransform: AxCoordinateTransform? = {
                guard let width = AnyCodable.double(params, "expectedCoordinateWidth"),
                      let height = AnyCodable.double(params, "expectedCoordinateHeight") else {
                    return nil
                }
                return AxCoordinateTransform(
                    originX: AnyCodable.double(params, "expectedCoordinateX") ?? 0,
                    originY: AnyCodable.double(params, "expectedCoordinateY") ?? 0,
                    sourceWidth: AnyCodable.double(params, "expectedCoordinateSourceWidth") ?? width,
                    sourceHeight: AnyCodable.double(params, "expectedCoordinateSourceHeight") ?? height,
                    coordinateWidth: width,
                    coordinateHeight: height
                )
            }()
            let targetHint = AxTargetHint(
                role: AnyCodable.string(params, "expectedRole"),
                name: AnyCodable.string(params, "expectedName"),
                value: AnyCodable.string(params, "expectedValue"),
                bounds: expectedBounds,
                coordinateTransform: coordinateTransform
            )
            _ = try validateCoordinateGeometry(params)
            let result = try axPerform(
                pid: pid,
                index: index,
                action: action,
                value: value,
                windowTitle: windowTitle,
                windowId: windowId,
                targetHint: targetHint.isEmpty ? nil : targetHint
            )
            return .success(id: request.id, result: result)
        case "validate_geometry":
            guard let geometry = try validateCoordinateGeometry(params) else {
                throw HelperError(code: "INVALID", message: "validate_geometry requires window coordinates")
            }
            return .success(id: request.id, result: [
                "ok": true,
                "window": rectDict(geometry.bounds),
            ])
        case "focus_app":
            guard let app = AnyCodable.string(params, "app") else {
                throw HelperError(code: "INVALID", message: "app required")
            }
            // Default: do not steal frontmost (background Computer Use).
            let activate = (params["activate"] as? Bool) ?? false
            try focusApp(query: app, activate: activate)
            return .success(id: request.id, result: ["ok": true, "activated": activate])
        case "launch_app":
            guard let app = AnyCodable.string(params, "app") else {
                throw HelperError(code: "INVALID", message: "app required")
            }
            let activate = (params["activate"] as? Bool) ?? false
            try launchApp(query: app, activate: activate)
            return .success(id: request.id, result: ["ok": true, "activated": activate])
        case "capture":
            let granted = AnyCodable.stringArray(params, "grantedBundleIds")
            let maxWidth = AnyCodable.int(params, "maxWidth")
            let allowAll = (params["allowAllApps"] as? Bool) ?? false
            let capture = AnyCodable.string(params, "capture") ?? "window"
            let windowId = AnyCodable.int(params, "windowId")
            let result: [String: Any]
            if capture == "window" {
                guard let windowId else {
                    throw HelperError(code: "INVALID", message: "window capture requires windowId")
                }
                result = try await captureWindow(
                    windowId: windowId,
                    grantedBundleIds: granted,
                    maxWidth: maxWidth,
                    allowAllApps: allowAll
                )
            } else if capture == "display" {
                result = try await captureDisplay(
                    grantedBundleIds: granted,
                    maxWidth: maxWidth,
                    allowAllApps: allowAll,
                    targetWindowId: windowId
                )
            } else {
                throw HelperError(code: "INVALID", message: "capture must be window or display")
            }
            return .success(id: request.id, result: result)
        case "zoom":
            let granted = AnyCodable.stringArray(params, "grantedBundleIds")
            let allowAll = (params["allowAllApps"] as? Bool) ?? false
            guard let region = AnyCodable.doubleArray(params, "region"), region.count == 4 else {
                throw HelperError(code: "INVALID", message: "region [x0,y0,x1,y1] required")
            }
            let maxWidth = AnyCodable.int(params, "maxWidth")
            let capture = AnyCodable.string(params, "capture") ?? "window"
            let windowId = AnyCodable.int(params, "windowId")
            _ = try validateCoordinateGeometry(params)
            let result = try await captureZoom(
                grantedBundleIds: granted,
                region: region,
                allowAllApps: allowAll,
                maxWidth: maxWidth,
                capture: capture,
                windowId: windowId
            )
            return .success(id: request.id, result: result)
        case "click":
            guard let x = AnyCodable.double(params, "x"),
                  let y = AnyCodable.double(params, "y") else {
                throw HelperError(code: "INVALID", message: "x,y required")
            }
            let button = AnyCodable.string(params, "button") ?? "left"
            let count = AnyCodable.int(params, "count") ?? 1
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            let point = try resolveCoordinatePoint(params, x: x, y: y)
            // Paint software cursor BEFORE HID so spring hop is visible during the click.
            maybeShowOverlayFromParams(params, cursor: point, pulseCursor: true, pulseRing: true)
            try postClick(
                x: point.x,
                y: point.y,
                button: button,
                count: count,
                delivery: delivery,
                targetPid: pid,
                requireFrontmostBundleId: front
            )
            AgentOverlayController.shared.scheduleHide(afterMs: 3500)
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
            ])
        case "type_text":
            guard let text = AnyCodable.string(params, "text") else {
                throw HelperError(code: "INVALID", message: "text required")
            }
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            _ = try validateCoordinateGeometry(params)
            // Menu-bar chip (and cursor if host already placed one via overlay_show_target).
            maybeShowOverlayFromParams(params, cursor: nil, pulseCursor: false, pulseRing: true)
            try typeText(
                text,
                delivery: delivery,
                targetPid: pid,
                requireFrontmostBundleId: front
            )
            AgentOverlayController.shared.scheduleHide(afterMs: 2500)
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
            ])
        case "keypress":
            guard let key = AnyCodable.string(params, "key") else {
                throw HelperError(code: "INVALID", message: "key required")
            }
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            _ = try validateCoordinateGeometry(params)
            maybeShowOverlayFromParams(params, cursor: nil, pulseCursor: false, pulseRing: false)
            try keypress(
                key,
                delivery: delivery,
                targetPid: pid,
                requireFrontmostBundleId: front
            )
            AgentOverlayController.shared.scheduleHide(afterMs: 2500)
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
            ])
        case "scroll":
            guard let x = AnyCodable.double(params, "x"),
                  let y = AnyCodable.double(params, "y") else {
                throw HelperError(code: "INVALID", message: "x,y required for scroll")
            }
            let dx = AnyCodable.double(params, "dx") ?? 0
            let dy = AnyCodable.double(params, "dy") ?? 0
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            let point = try resolveCoordinatePoint(params, x: x, y: y)
            // Menu-bar chip + cursor first, then postScroll owns mid-scroll pulses.
            maybeShowOverlayFromParams(params, cursor: point, pulseCursor: true, pulseRing: false)
            try postScroll(
                x: point.x, y: point.y, dx: dx, dy: dy,
                delivery: delivery,
                targetPid: pid,
                requireFrontmostBundleId: front
            )
            // Keep software cursor visible long enough for a human to notice.
            AgentOverlayController.shared.scheduleHide(afterMs: 5000)
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
                "dx": dx,
                "dy": dy,
            ])
        case "drag":
            // path: [[x,y], ...] or [{x,y}, ...]
            guard let pathRaw = params["path"] as? [Any], pathRaw.count >= 2 else {
                throw HelperError(code: "INVALID", message: "path needs ≥2 points")
            }
            func pointFrom(_ item: Any) -> CGPoint? {
                if let arr = item as? [NSNumber], arr.count >= 2 {
                    return CGPoint(x: arr[0].doubleValue, y: arr[1].doubleValue)
                }
                if let arr = item as? [Any], arr.count >= 2 {
                    let x = (arr[0] as? NSNumber)?.doubleValue ?? arr[0] as? Double
                    let y = (arr[1] as? NSNumber)?.doubleValue ?? arr[1] as? Double
                    if let x, let y { return CGPoint(x: x, y: y) }
                }
                if let dict = item as? [String: Any] {
                    let x = (dict["x"] as? NSNumber)?.doubleValue ?? dict["x"] as? Double
                    let y = (dict["y"] as? NSNumber)?.doubleValue ?? dict["y"] as? Double
                    if let x, let y { return CGPoint(x: x, y: y) }
                }
                return nil
            }
            var points: [CGPoint] = []
            for item in pathRaw {
                guard let p = pointFrom(item) else {
                    throw HelperError(code: "INVALID", message: "path point must be {x,y} or [x,y]")
                }
                points.append(p)
            }
            let windowGeometry = try validateCoordinateGeometry(params)
            points = try points.map {
                try resolveCoordinatePoint(params, x: $0.x, y: $0.y, validatedWindow: windowGeometry)
            }
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            maybeShowOverlayFromParams(params, cursor: points.first, pulseCursor: true, pulseRing: false)
            // postDrag densifies path and drives the virtual cursor step-by-step
            // (async animateCursor alone races and is easy to miss).
            try postDrag(
                path: points,
                delivery: delivery,
                targetPid: pid,
                requireFrontmostBundleId: front
            )
            AgentOverlayController.shared.scheduleHide(afterMs: 5000)
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
                "points": points.count,
            ])
        case "move_mouse":
            guard let x = AnyCodable.double(params, "x"),
                  let y = AnyCodable.double(params, "y") else {
                throw HelperError(code: "INVALID", message: "x,y required")
            }
            let delivery = parseDelivery(AnyCodable.string(params, "delivery"))
            let front = AnyCodable.string(params, "requireFrontmostBundleId")
            let pid = resolvePid(
                bundleId: AnyCodable.string(params, "targetBundleId") ?? front,
                pid: AnyCodable.int(params, "targetPid")
            )
            let point = try resolveCoordinatePoint(params, x: x, y: y)
            // Always paint the software cursor first — visibility must not depend on HID.
            maybeShowOverlayFromParams(params, cursor: point, pulseCursor: true, pulseRing: false)
            AgentOverlayController.shared.moveCursor(quartz: point, pulse: true)
            AgentOverlayController.shared.scheduleHide(afterMs: 8000)
            if delivery == .global {
                try requireFrontmost(bundleId: front)
            }
            // HID post is best-effort; cursor still shows if pid missing.
            if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
                do {
                    try postEvent(move, delivery: delivery, pid: pid)
                } catch {
                    // still return ok for visual path
                }
            }
            return .success(id: request.id, result: [
                "ok": true,
                "unknown": true,
                "delivery": delivery.rawValue,
                "cursor": ["x": Double(point.x), "y": Double(point.y)],
            ])
        case "overlay_set_enabled":
            let enabled = (params["enabled"] as? Bool) ?? true
            AgentOverlayController.shared.setEnabled(enabled)
            if !enabled {
                AgentOverlayController.shared.hideImmediately()
            }
            return .success(id: request.id, result: ["ok": true, "enabled": enabled])
        case "overlay_show_target":
            let app = AnyCodable.string(params, "app")
                ?? AnyCodable.string(params, "windowApp")
                ?? ""
            let bundleId = AnyCodable.string(params, "bundleId")
                ?? AnyCodable.string(params, "targetBundleId")
                ?? AnyCodable.string(params, "windowBundleId")
            if app.isEmpty && (bundleId == nil || bundleId?.isEmpty == true) {
                throw HelperError(code: "INVALID", message: "app or bundleId required")
            }
            let windowId = AnyCodable.int(params, "windowId")
            let windowLayer = AnyCodable.int(params, "windowLayer")
            AgentOverlayController.shared.showActive(
                appName: app,
                bundleId: bundleId,
                windowId: windowId,
                windowLayer: windowLayer,
                sessionId: AnyCodable.string(params, "sessionId")
            )
            if let cx = AnyCodable.double(params, "cursorX"),
               let cy = AnyCodable.double(params, "cursorY") {
                let pulse = (params["pulseRing"] as? Bool) ?? false
                let cursor = try resolveCoordinatePoint(params, x: cx, y: cy)
                AgentOverlayController.shared.moveCursor(
                    quartz: cursor,
                    pulse: pulse
                )
            }
            return .success(id: request.id, result: ["ok": true, "mode": "status_item+cursor"])
        case "overlay_cursor":
            guard let x = AnyCodable.double(params, "x"),
                  let y = AnyCodable.double(params, "y") else {
                throw HelperError(code: "INVALID", message: "x,y required")
            }
            let pulse = (params["pulse"] as? Bool) ?? true
            let app = AnyCodable.string(params, "app") ?? ""
            let bundleId = AnyCodable.string(params, "bundleId")
                ?? AnyCodable.string(params, "targetBundleId")
            if !app.isEmpty || bundleId != nil {
                AgentOverlayController.shared.showActive(appName: app, bundleId: bundleId)
            }
            AgentOverlayController.shared.moveCursor(
                quartz: CGPoint(x: x, y: y),
                pulse: pulse
            )
            return .success(id: request.id, result: ["ok": true, "mode": "status_item+cursor"])
        case "overlay_hide":
            let delayMs = AnyCodable.int(params, "delayMs") ?? 0
            if delayMs > 0 {
                AgentOverlayController.shared.scheduleHide(afterMs: delayMs)
            } else {
                AgentOverlayController.shared.hideImmediately()
            }
            return .success(id: request.id, result: ["ok": true])
        case "terminate":
            AgentOverlayController.shared.hideImmediately()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                exit(0)
            }
            return .success(id: request.id, result: ["ok": true])
        default:
            return .failure(id: request.id, code: "UNKNOWN_METHOD", message: request.method)
        }
    } catch let e as HelperError {
        return .failure(id: request.id, code: e.code, message: e.message)
    } catch {
        return .failure(id: request.id, code: "BACKEND", message: String(describing: error))
    }
}

// MARK: - Socket server

/// Reverse channel: helper → host.
///
/// The wire protocol is request/response only, so the helper has no way to speak
/// first — which menu actions (e.g. Stop) need. Events are line-delimited JSON
/// carrying an `event` key and **no `id`**, so the host client can tell them
/// apart from responses by shape alone.
///
/// All socket writes funnel through this serial queue: responses are written
/// from per-client reader threads while events are emitted from the main thread,
/// and unsynchronised writes would interleave mid-line.
final class HelperEventBus {
    static let shared = HelperEventBus()

    private let queue = DispatchQueue(label: "dev.superone.computer-use.eventbus")
    private var clients: Set<Int32> = []

    func register(_ fd: Int32) {
        queue.sync { _ = clients.insert(fd) }
    }

    func unregister(_ fd: Int32) {
        queue.sync { _ = clients.remove(fd) }
    }

    /// Write a response line to one client.
    func send(_ data: Data, to fd: Int32) {
        queue.sync { HelperEventBus.writeLine(data, to: fd) }
    }

    /// Broadcast an event to every connected host.
    func emit(_ event: String, _ payload: [String: Any] = [:]) {
        var body = payload
        body["event"] = event
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        queue.sync {
            for fd in clients { HelperEventBus.writeLine(data, to: fd) }
        }
    }

    private static func writeLine(_ data: Data, to fd: Int32) {
        data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            _ = Darwin.write(fd, base, data.count)
        }
        _ = Darwin.write(fd, "\n", 1)
    }
}

final class SocketServer {
    let path: String
    private var fd: Int32 = -1

    init(path: String) {
        self.path = path
    }

    func start() throws {
        unlink(path)
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw HelperError(code: "SOCKET", message: "socket() failed") }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let maxLen = MemoryLayout.size(ofValue: addr.sun_path) - 1
        let pathBytes = path.utf8CString
        guard pathBytes.count <= maxLen else {
            throw HelperError(code: "SOCKET", message: "socket path too long")
        }
        withUnsafeMutablePointer(to: &addr.sun_path.0) { ptr in
            pathBytes.withUnsafeBufferPointer { buf in
                ptr.update(from: buf.baseAddress!, count: buf.count)
            }
        }

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            throw HelperError(code: "SOCKET", message: "bind failed: \(String(cString: strerror(errno)))")
        }
        // User-only permissions
        chmod(path, 0o600)
        guard listen(fd, 16) == 0 else {
            throw HelperError(code: "SOCKET", message: "listen failed")
        }
    }

    func acceptLoop() {
        while true {
            let client = accept(fd, nil, nil)
            if client < 0 { continue }
            DispatchQueue.global(qos: .userInitiated).async {
                self.handleClient(client)
            }
        }
    }

    private func handleClient(_ client: Int32) {
        HelperEventBus.shared.register(client)
        defer {
            HelperEventBus.shared.unregister(client)
            close(client)
        }
        var buffer = Data()
        var tmp = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = read(client, &tmp, tmp.count)
            if n <= 0 { break }
            buffer.append(contentsOf: tmp[0..<n])
            while let range = buffer.range(of: Data([0x0A])) {
                let line = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
                buffer.removeSubrange(buffer.startIndex...range.lowerBound)
                guard !line.isEmpty else { continue }
                processLine(line, client: client)
            }
        }
    }

    private func processLine(_ line: Data, client: Int32) {
        let decoder = JSONDecoder()
        let encoder = JSONEncoder()
        guard let req = try? decoder.decode(HelperRequest.self, from: line) else {
            let err = HelperResponse.failure(id: "?", code: "PARSE", message: "invalid JSON request")
            if let data = try? encoder.encode(err) {
                HelperEventBus.shared.send(data, to: client)
            }
            return
        }
        let sem = DispatchSemaphore(value: 0)
        var response: HelperResponse!
        Task {
            response = await handle(request: req)
            sem.signal()
        }
        sem.wait()
        if let data = try? encoder.encode(response) {
            HelperEventBus.shared.send(data, to: client)
        }
    }
}

// MARK: - App entry

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: SocketServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let args = CommandLine.arguments
        // Expected: <exec> --socket <path>
        var socketPath: String?
        if let idx = args.firstIndex(of: "--socket"), idx + 1 < args.count {
            socketPath = args[idx + 1]
        } else if args.count >= 2, args[1].hasSuffix(".sock") {
            socketPath = args[1]
        } else {
            socketPath = FileManager.default.temporaryDirectory
                .appendingPathComponent("superone-computer-use.sock").path
        }

        do {
            let server = SocketServer(path: socketPath!)
            try server.start()
            self.server = server
            FileHandle.standardError.write(Data("[superone-cu-helper] listening on \(socketPath!)\n".utf8))
            DispatchQueue.global(qos: .userInitiated).async {
                server.acceptLoop()
            }
        } catch {
            FileHandle.standardError.write(Data("[superone-cu-helper] failed: \(error)\n".utf8))
            exit(1)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
