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
import Darwin
import Foundation
import SQLite3

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
// - Runtime: AXIsProcessTrusted / CGPreflightScreenCaptureAccess (never SCShareableContent probe).
// - Persisted: read TCC.db auth_value for this helper's bundle id + path (OCU dual-channel).
// - UI "granted" = runtime only. A persisted TCC grant may request one relaunch,
//   but it is never reported as usable until runtime preflight succeeds.

func axTrusted() -> Bool {
    AXIsProcessTrusted()
}

/// Ask macOS to add this helper to Accessibility and open the matching
/// System Settings pane when approval is still missing.
func requestAccessibilityAccess() -> Bool {
    let options = [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
    ] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
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

private struct PermissionClientRecord: Hashable {
    let identifier: String
    let type: Int32 // 0 = bundle id, 1 = path
}

/// Candidates for TCC.db client matching (bundle id first, then path).
private func currentPermissionClients() -> [PermissionClientRecord] {
    var records: [PermissionClientRecord] = []
    var seen = Set<PermissionClientRecord>()
    func append(_ record: PermissionClientRecord) {
        if seen.insert(record).inserted {
            records.append(record)
        }
    }
    if let bundleId = Bundle.main.bundleIdentifier, !bundleId.isEmpty {
        append(PermissionClientRecord(identifier: bundleId, type: 0))
    }
    let path = Bundle.main.bundleURL.standardizedFileURL.path
    if !path.isEmpty {
        append(PermissionClientRecord(identifier: path, type: 1))
    }
    return records
}

/// auth_value 2 = allowed (same as Open Computer Use).
private func tccAuthorizationGranted(authValues: [Int32]) -> Bool {
    authValues.contains(2)
}

private func tccAuthorization(
    service: String,
    clients: [PermissionClientRecord],
    databasePath: String
) -> Bool? {
    guard !clients.isEmpty else { return nil }
    var database: OpaquePointer?
    guard sqlite3_open_v2(databasePath, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        if database != nil { sqlite3_close(database) }
        return nil
    }
    defer { sqlite3_close(database) }

    let query = """
    SELECT auth_value
    FROM access
    WHERE service = ? AND client = ? AND client_type = ?
    ORDER BY last_modified DESC
    LIMIT 1;
    """
    let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    var authValues: [Int32] = []

    for client in clients {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK else {
            if statement != nil { sqlite3_finalize(statement) }
            return nil
        }
        defer { sqlite3_finalize(statement) }

        sqlite3_bind_text(statement, 1, service, -1, sqliteTransient)
        sqlite3_bind_text(statement, 2, client.identifier, -1, sqliteTransient)
        sqlite3_bind_int(statement, 3, client.type)

        if sqlite3_step(statement) == SQLITE_ROW {
            authValues.append(sqlite3_column_int(statement, 0))
        }
    }

    if authValues.isEmpty { return nil }
    return tccAuthorizationGranted(authValues: authValues)
}

/// Best-effort TCC.db read (system + user DBs). Returns nil when unreadable / no row.
private func tccPersistedGrants() -> (accessibility: Bool?, screenRecording: Bool?) {
    let clients = currentPermissionClients()
    let paths = [
        "/Library/Application Support/com.apple.TCC/TCC.db",
        NSHomeDirectory() + "/Library/Application Support/com.apple.TCC/TCC.db",
    ]
    var accessibility: Bool?
    var screenRecording: Bool?
    for path in paths {
        if accessibility != true,
           let value = tccAuthorization(
            service: "kTCCServiceAccessibility",
            clients: clients,
            databasePath: path
           ) {
            accessibility = (accessibility == true) || value
        }
        if screenRecording != true,
           let value = tccAuthorization(
            service: "kTCCServiceScreenCapture",
            clients: clients,
            databasePath: path
           ) {
            screenRecording = (screenRecording == true) || value
        }
    }
    return (accessibility, screenRecording)
}

func doctor() -> [String: Any] {
    let axRuntime = axTrusted()
    let screenRuntime = screenRecordingTrusted()
    let tcc = tccPersistedGrants()
    let screenPersisted = tcc.screenRecording == true
    // A persisted grant can update before the running process sees it.
    let screenNeedsRelaunch = screenPersisted && !screenRuntime
    return [
        "accessibility": axRuntime ? "granted" : "missing",
        "screenRecording": screenRuntime ? "granted" : "missing",
        "bundleId": Bundle.main.bundleIdentifier ?? "unknown",
        "bundlePath": Bundle.main.bundleURL.path,
        "pid": ProcessInfo.processInfo.processIdentifier,
        "screenRecordingNeedsRelaunch": screenNeedsRelaunch,
        "accessibilityRuntime": axRuntime ? "granted" : "missing",
        "screenRecordingRuntime": screenRuntime ? "granted" : "missing",
        "accessibilityPersisted": tcc.accessibility == true ? "granted" : "missing",
        "screenRecordingPersisted": screenPersisted ? "granted" : "missing",
    ]
}

// MARK: - Input

struct HelperError: Error {
    let code: String
    let message: String
}

// MARK: - Overlay helpers (params from Electron)

/// Map capture-space (or already-global) cursor coords to screen-state points.
/// Prefer live geometry via `resolveCoordinatePoint`; fall back to window bounds
/// on the payload so a stale window never leaves the tip at raw local (0…W)
/// coordinates near the display origin.
func resolveCursorQuartzPoint(params: [String: Any], x: Double, y: Double) -> CGPoint {
    if let mapped = try? resolveCoordinatePoint(params, x: x, y: y) {
        return mapped
    }
    let wx = AnyCodable.double(params, "windowX")
        ?? AnyCodable.double(params, "capturedX")
        ?? 0
    let wy = AnyCodable.double(params, "windowY")
        ?? AnyCodable.double(params, "capturedY")
        ?? 0
    let ww = AnyCodable.double(params, "capturedWidth")
        ?? AnyCodable.double(params, "windowWidth")
        ?? 0
    let wh = AnyCodable.double(params, "capturedHeight")
        ?? AnyCodable.double(params, "windowHeight")
        ?? 0
    let cw = AnyCodable.double(params, "coordinateWidth") ?? ww
    let ch = AnyCodable.double(params, "coordinateHeight") ?? wh
    if cw > 1, ch > 1, ww > 1, wh > 1 {
        return CGPoint(x: wx + x * ww / cw, y: wy + y * wh / ch)
    }
    // Last resort: treat as already-global screen-state.
    return CGPoint(x: x, y: y)
}

/// Optional window bounds + app name on act payloads for the visual ring.
func maybeShowOverlayFromParams(
    _ params: [String: Any],
    cursor: CGPoint?,
    pulseCursor: Bool,
    pulseRing: Bool,
    /// Wait for the hop so sequential actions don't cancel mid-flight.
    waitForCursor: Bool = true
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
            AgentOverlayController.shared.moveCursor(
                quartz: cursor, pulse: pulseCursor, wait: waitForCursor
            )
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
        windowLayer: windowLayer,
        sessionId: AnyCodable.string(params, "sessionId"),
        locale: AnyCodable.string(params, "locale")
    )
    AgentOverlayController.shared.setWatchedTarget(bundleId: bundleId, pid: targetPid)
    if let cursor {
        AgentOverlayController.shared.moveCursor(
            quartz: cursor, pulse: pulseCursor || pulseRing, wait: waitForCursor
        )
    }
    _ = bx
    _ = by
    _ = bw
    _ = bh
}

// MARK: - Dispatch

final class HostLifecycle {
    static let shared = HostLifecycle()

    private let queue = DispatchQueue(label: "dev.superone.computer-use.host-lifecycle")
    private var hostPid: pid_t = 0
    private var processSource: DispatchSourceProcess?

    func watch(pid: Int) {
        guard pid > 1 else { return }
        queue.async {
            self.processSource?.cancel()
            self.processSource = nil
            self.hostPid = pid_t(pid)

            // Close the race where the host exits just before the process
            // source is registered. The source handles all later exits.
            guard self.isHostAlive() else {
                self.handleHostExit()
                return
            }

            let source = DispatchSource.makeProcessSource(
                identifier: self.hostPid,
                eventMask: .exit,
                queue: self.queue,
            )
            source.setEventHandler { [weak self] in
                self?.handleHostExit()
            }
            self.processSource = source
            source.resume()
        }
    }

    private func isHostAlive() -> Bool {
        guard hostPid > 1 else { return false }
        errno = 0
        if Darwin.kill(hostPid, 0) == 0 { return true }
        return errno == EPERM
    }

    private func handleHostExit() {
        processSource?.cancel()
        processSource = nil
        hostPid = 0
        AgentOverlayController.shared.hideImmediately()
        WindowPlacementController.shared.restoreAllImmediately()
        exit(0)
    }
}

func handle(request: HelperRequest) async -> HelperResponse {
    let params = request.params?.mapValues { $0.value } ?? [:]
    do {
        switch request.method {
        case "ping":
            return .success(id: request.id, result: ["pong": true])
        case "doctor":
            return .success(id: request.id, result: doctor())
        case "set_host":
            guard let pid = AnyCodable.int(params, "pid"), pid > 1 else {
                throw HelperError(code: "INVALID", message: "valid host pid required")
            }
            HostLifecycle.shared.watch(pid: pid)
            return .success(id: request.id, result: ["ok": true, "pid": pid])
        case "request_accessibility":
            let granted = requestAccessibilityAccess()
            return .success(id: request.id, result: [
                "accessibility": granted ? "granted" : "missing",
            ])
        case "request_screen_recording":
            // One-shot TCC prompt; client should restart helper after user grants.
            let granted = requestScreenRecordingAccess()
            return .success(id: request.id, result: [
                "screenRecording": granted ? "granted" : "missing",
                "needsRelaunch": !granted,
            ])
        case "list_apps":
            return .success(id: request.id, result: ["apps": listRunningApps()])
        case "frontmost":
            return .success(id: request.id, result: frontmostApp() as Any)
        case "list_windows":
            return .success(
                id: request.id,
                result: ["windows": listWindows(
                    scanBundleIds: AnyCodable.stringArray(params, "scanBundleIds")
                )]
            )
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
            let axRootId = AnyCodable.string(params, "axRootId")
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
                axRootId: axRootId,
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
            let axRootId = AnyCodable.string(params, "axRootId")
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
                axRootId: axRootId,
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
        case "focus_window":
            guard let pid = AnyCodable.int(params, "pid"),
                  let windowId = AnyCodable.int(params, "windowId") else {
                throw HelperError(code: "INVALID", message: "pid and windowId required")
            }
            try focusWindow(
                pid: pid,
                windowId: windowId,
                windowTitle: AnyCodable.string(params, "windowTitle")
            )
            return .success(id: request.id, result: ["ok": true])
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
            let axRootId = AnyCodable.string(params, "axRootId")
            let pid = AnyCodable.int(params, "pid").map(pid_t.init)
            let result: [String: Any]
            if capture == "window" {
                // Transient CGWindow captures can include their parent composite;
                // registered AX bounds are the canonical transient capture region.
                if let axRootId, let pid {
                    result = try await captureAxRoot(
                        axRootId: axRootId,
                        pid: pid,
                        grantedBundleIds: granted,
                        maxWidth: maxWidth,
                        allowAllApps: allowAll
                    )
                } else if let windowId {
                    result = try await captureWindow(
                        windowId: windowId,
                        grantedBundleIds: granted,
                        maxWidth: maxWidth,
                        allowAllApps: allowAll
                    )
                } else {
                    throw HelperError(code: "INVALID", message: "window capture requires windowId or axRootId")
                }
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
        case "record_start", "record_stop":
            let result = try await handleActionRecordingCommand(request.method, params: params)
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
            let axRootId = AnyCodable.string(params, "axRootId")
            let pid = AnyCodable.int(params, "pid").map(pid_t.init)
            _ = try validateCoordinateGeometry(params)
            let result = try await captureZoom(
                grantedBundleIds: granted,
                region: region,
                allowAllApps: allowAll,
                maxWidth: maxWidth,
                capture: capture,
                windowId: windowId,
                axRootId: axRootId,
                pid: pid
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
            // Host owns visibility duration — do not auto-hide after this action.
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
            // maybeShowOverlay already waits for the hop; do not double-moveCursor.
            maybeShowOverlayFromParams(params, cursor: point, pulseCursor: true, pulseRing: false)
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
            let cursorX = AnyCodable.double(params, "cursorX")
            let cursorY = AnyCodable.double(params, "cursorY")
            let hasCursor = cursorX != nil && cursorY != nil
            AgentOverlayController.shared.showActive(
                appName: app,
                bundleId: bundleId,
                windowId: windowId,
                windowLayer: windowLayer,
                sessionId: AnyCodable.string(params, "sessionId"),
                locale: AnyCodable.string(params, "locale"),
                hideCursor: ((params["hideCursor"] as? Bool) ?? false) && !hasCursor
            )
            if let cx = cursorX, let cy = cursorY {
                let pulse = (params["pulseRing"] as? Bool) ?? false
                let cursor = resolveCursorQuartzPoint(params: params, x: cx, y: cy)
                // Wait so host-side showActionCursor finishes the hop before HID.
                AgentOverlayController.shared.moveCursor(
                    quartz: cursor,
                    pulse: pulse,
                    wait: true
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
                AgentOverlayController.shared.showActive(
                    appName: app,
                    bundleId: bundleId,
                    sessionId: AnyCodable.string(params, "sessionId"),
                    locale: AnyCodable.string(params, "locale")
                )
            }
            let cursor = resolveCursorQuartzPoint(params: params, x: x, y: y)
            AgentOverlayController.shared.moveCursor(
                quartz: cursor,
                pulse: pulse,
                wait: true
            )
            return .success(id: request.id, result: ["ok": true, "mode": "status_item+cursor"])
        case "overlay_cursor_visible":
            // Suspend/resume software cursor around screenshots without clearing
            // tip state. Status chip is unaffected.
            let visible = (params["visible"] as? Bool) ?? true
            AgentOverlayController.shared.setCursorSuspended(!visible)
            return .success(id: request.id, result: ["ok": true, "visible": visible])
        case "overlay_hide":
            let delayMs = AnyCodable.int(params, "delayMs") ?? 0
            let sessionId = AnyCodable.string(params, "sessionId") ?? ""
            if !sessionId.isEmpty {
                AgentOverlayController.shared.hideImmediately(sessionId: sessionId)
            } else if delayMs > 0 {
                AgentOverlayController.shared.scheduleHide(afterMs: delayMs)
            } else {
                AgentOverlayController.shared.hideImmediately()
            }
            return .success(id: request.id, result: ["ok": true])
        case "pip_set_enabled", "pip_show_target", "pip_update_cursor", "pip_hide", "pip_restore",
             "pip_resize":
            let result = try await handlePictureInPictureCommand(request.method, params: params)
            return .success(id: request.id, result: result)
        case "display_place_window", "display_restore_session", "display_restore_all":
            let result = try handleWindowPlacementCommand(request.method, params: params)
            return .success(id: request.id, result: result)
        case "session_clear_visuals":
            let sessionId = AnyCodable.string(params, "sessionId") ?? ""
            if sessionId.isEmpty {
                AgentOverlayController.shared.hideImmediately()
                await PictureInPictureController.shared.hide(
                    sessionId: nil,
                    clearDismissal: true
                )
                _ = WindowPlacementController.shared.restoreAll()
            } else {
                AgentOverlayController.shared.hideImmediately(sessionId: sessionId)
                await PictureInPictureController.shared.hide(
                    sessionId: sessionId,
                    clearDismissal: true
                )
                _ = WindowPlacementController.shared.restore(sessionId: sessionId)
            }
            return .success(id: request.id, result: ["ok": true])
        // iPhone Mirroring. Separate from `list_windows` / `ax_tree` because the
        // question is inverted: those ask what UI a window contains, while a mirroring
        // window is healthy precisely when it contains none — see `Mirror.swift`.
        case "mirror_state":
            return .success(id: request.id, result: mirrorState())
        case "mirror_launch":
            try launchMirrorApp()
            return .success(id: request.id, result: mirrorState())
        case "ocr":
            guard let encoded = AnyCodable.string(params, "data"),
                  let png = Data(base64Encoded: encoded) else {
                throw HelperError(code: "INVALID", message: "base64 png data required")
            }
            let minConfidence = AnyCodable.double(params, "minConfidence") ?? 0.3
            return .success(id: request.id, result: [
                "texts": try recognizeText(pngData: png, minConfidence: minConfidence),
            ])
        case "terminate":
            AgentOverlayController.shared.hideImmediately()
            PictureInPictureController.shared.hideImmediately()
            WindowPlacementController.shared.restoreAllImmediately()
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
            var written = 0
            while written < data.count {
                let count = Darwin.write(fd, base.advanced(by: written), data.count - written)
                if count > 0 {
                    written += count
                    continue
                }
                if count < 0 && errno == EINTR { continue }
                return
            }
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
            // Frame events are frequent and can race a renderer disconnect. Convert
            // a closed peer into EPIPE instead of terminating the helper with SIGPIPE.
            var noSigPipe: Int32 = 1
            _ = setsockopt(
                client,
                SOL_SOCKET,
                SO_NOSIGPIPE,
                &noSigPipe,
                socklen_t(MemoryLayout<Int32>.size)
            )
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
        var parentPid: Int?
        if let idx = args.firstIndex(of: "--socket"), idx + 1 < args.count {
            socketPath = args[idx + 1]
        } else if args.count >= 2, args[1].hasSuffix(".sock") {
            socketPath = args[1]
        } else {
            socketPath = FileManager.default.temporaryDirectory
                .appendingPathComponent("superone-computer-use-release.sock").path
        }
        if let idx = args.firstIndex(of: "--parent-pid"), idx + 1 < args.count {
            parentPid = Int(args[idx + 1])
        }
        if let parentPid {
            HostLifecycle.shared.watch(pid: parentPid)
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

    func applicationWillTerminate(_ notification: Notification) {
        WindowPlacementController.shared.restoreAllImmediately()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
