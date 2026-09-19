import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import SQLite3

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
