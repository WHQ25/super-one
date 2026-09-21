import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

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

/// Wall-clock ceiling for one whole scan. Per-message timeouts bound a single AX
/// call; this bounds their sum, so N unresponsive apps cannot add up past the
/// host's RPC timeout. Degrading (returning fewer roots) beats answering nothing.
let axDiscoveryBudget: TimeInterval = 3

func listWindows(
    scanBundleIds: [String] = [],
    diagnostics: ([String: Any]) -> Void = { _ in }
) -> [[String: Any]] {
    var axFailures: [String: Int] = [:]
    var budgetExceeded = false
    var returnedCount = 0
    var cgListAvailable = false
    defer {
        diagnostics([
            "axTrusted": axTrusted(), "cgListAvailable": cgListAvailable,
            "axBudgetExceeded": budgetExceeded, "axFailures": axFailures,
            "returnedCount": returnedCount,
        ])
    }
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    let deadline = Date().addingTimeInterval(axDiscoveryBudget)
    cgListAvailable = true
    let selfPid = Int(ProcessInfo.processInfo.processIdentifier)
    var roots: [[String: Any]] = []
    for window in info {
        let layer = window[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0 else { continue }
        let owner = window[kCGWindowOwnerName as String] as? String ?? ""
        let title = window[kCGWindowName as String] as? String ?? ""
        let pid = window[kCGWindowOwnerPID as String] as? Int ?? 0
        if pid == selfPid { continue }
        let bounds = window[kCGWindowBounds as String] as? [String: Any]
        let x = bounds?["X"] as? CGFloat ?? 0
        let y = bounds?["Y"] as? CGFloat ?? 0
        let width = bounds?["Width"] as? CGFloat ?? 0
        let height = bounds?["Height"] as? CGFloat ?? 0
        let windowId = window[kCGWindowNumber as String] as? Int ?? 0
        // The sharing indicator on a captured window's title bar is a layer-0
        // window too; see axRootMinimumSize.
        guard width >= axRootMinimumSize.width, height >= axRootMinimumSize.height else { continue }
        let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""
        // A CG window row is cheap and always reported; only its AX enrichment is
        // skipped once the budget is gone, so a stalled app costs detail, not rows.
        var axMetadata: AxWindowMetadata?
        if axTrusted() && windowId > 0 {
            if Date() < deadline {
                do {
                    axMetadata = try resolveAxWindow(
                        pid: pid_t(pid), windowId: windowId, windowTitle: title,
                        messagingTimeout: axDiscoveryMessagingTimeout
                    )
                } catch {
                    let code = (error as? HelperError)?.code ?? "UNKNOWN"
                    axFailures[code, default: 0] += 1
                }
            } else {
                budgetExceeded = true
            }
        }
        let classification = axMetadata.map(classifyAxWindow)
        roots.append([
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
        ])
    }

    returnedCount = roots.count
    guard axTrusted() else { return roots }
    let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.activationPolicy == .regular && Int($0.processIdentifier) != selfPid
    }
    for app in apps {
        if Date() >= deadline {
            budgetExceeded = true
            break
        }
        // An app that has already gone does not answer AX; skipping it is free.
        // A *quitting* one still reports false here — that case is on the timeout.
        if app.isTerminated { continue }
        let pid = app.processIdentifier
        let cgRootCount = roots.filter { ($0["pid"] as? Int) == Int(pid) }.count
        let transients = discoverAxTransientRoots(
            pid: pid,
            includeDescendants: pid == frontPid
                || cgRootCount > 1
                || scanBundleIds.contains(app.bundleIdentifier ?? ""),
            messagingTimeout: axDiscoveryMessagingTimeout
        )
        for transient in transients {
            let classification = classifyAxWindow(transient.metadata)
            if let existingIndex = roots.firstIndex(where: { root in
                guard (root["pid"] as? Int) == Int(pid),
                      let bounds = root["bounds"] as? [String: Double] else { return false }
                let frame = CGRect(
                    x: bounds["x"] ?? 0,
                    y: bounds["y"] ?? 0,
                    width: bounds["width"] ?? 0,
                    height: bounds["height"] ?? 0
                )
                return axFramesMatch(frame, transient.bounds)
            }) {
                roots[existingIndex]["kind"] = classification.kind
                roots[existingIndex]["modal"] = classification.modal
                roots[existingIndex]["focused"] = transient.metadata.focused
                roots[existingIndex]["axRootId"] = transient.id
                if (roots[existingIndex]["title"] as? String)?.isEmpty != false {
                    roots[existingIndex]["title"] = transient.title
                }
                continue
            }
            roots.append([
                "app": app.localizedName ?? "",
                "bundleId": app.bundleIdentifier ?? "",
                "pid": Int(pid),
                "title": transient.title,
                "bounds": rectDict(transient.bounds),
                "focused": transient.metadata.focused,
                "visible": true,
                "minimized": false,
                "modal": classification.modal,
                "kind": classification.kind,
                "resourceKey": "pid:\(pid)",
                "axRootId": transient.id,
            ])
        }
    }
    if budgetExceeded {
        FileHandle.standardError.write(Data(
            "[superone-cu-helper] list_windows exceeded \(axDiscoveryBudget)s AX budget — result is partial\n".utf8
        ))
    }
    returnedCount = roots.count
    return roots
}

/// Bring a hidden app into a usable state without stealing the frontmost app.
func focusApp(query: String, activate: Bool = false) throws {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    guard let match = apps.first(where: {
        $0.bundleIdentifier == query
            || $0.localizedName?.caseInsensitiveCompare(query) == .orderedSame
    }) else {
        throw HelperError(code: "APP_NOT_FOUND", message: "App not found: \(query)")
    }
    if match.isHidden { match.unhide() }
    if activate {
        FocusStealGuard.expectActivation(pid: match.processIdentifier)
        match.activate()
    }
}

/// Close a context menu the agent opened, once its items have been read. The
/// menu is the app's own pop-up-level window and draws above everything on
/// screen, the user's window included; `AXCancel` on the `AXMenu` takes it
/// down the way Escape would, without an event anything else could hear.
/// Only a menu: a sheet or dialog left open is the agent's to deal with.
func dismissMenuRoot(pid: pid_t, axRootId: String) throws {
    let element = try resolveRegisteredAxRoot(id: axRootId, pid: pid)
    guard axRole(element) == "AXMenu" else {
        throw HelperError(code: "INVALID", message: "Root \(axRootId) is not a menu")
    }
    let result = AXUIElementPerformAction(element, kAXCancelAction as CFString)
    // The menu may already be gone — pressing an item closed it — and a
    // vanished element reports invalid rather than success.
    if result != .success && result != .invalidUIElement {
        throw HelperError(code: "AX_ACTION", message: "Failed to dismiss menu \(axRootId) (\(result.rawValue))")
    }
}

/// Bring one exact Computer Use target window to the front after its PiP is clicked.
func focusWindow(pid: Int, windowId: Int, windowTitle: String? = nil) throws {
    guard axTrusted() else {
        throw HelperError(
            code: "AX_MISSING",
            message: "Accessibility permission not granted for Computer Use helper"
        )
    }
    let processId = pid_t(pid)
    guard let runningApp = NSRunningApplication(processIdentifier: processId) else {
        throw HelperError(code: "APP_NOT_FOUND", message: "App process not found: \(pid)")
    }
    let target = try resolveAxWindow(
        pid: processId,
        windowId: windowId,
        windowTitle: windowTitle
    ).element
    let app = axApplication(processId)

    if runningApp.isHidden { runningApp.unhide() }
    AXUIElementSetAttributeValue(target, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    AXUIElementSetAttributeValue(target, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, kAXFocusedWindowAttribute as CFString, target)
    FocusStealGuard.expectActivation(pid: processId)
    runningApp.activate()

    let result = AXUIElementPerformAction(target, kAXRaiseAction as CFString)
    if result != .success {
        throw HelperError(
            code: "AX_ACTION",
            message: "Failed to raise window \(windowId) (\(result.rawValue))"
        )
    }
}

/// Launch without frontmost activation so Computer Use can work in the background.
func launchApp(query: String, activate: Bool = false) throws {
    let config = NSWorkspace.OpenConfiguration()
    config.activates = activate
    let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query)
        ?? NSWorkspace.shared.urlForApplication(toOpen: URL(fileURLWithPath: "/Applications/\(query).app"))
    if let url {
        // A launch the caller wants in front is the helper's own activation.
        if activate, let bundleId = Bundle(url: url)?.bundleIdentifier {
            FocusStealGuard.expectActivation(bundleId: bundleId)
        }
        NSWorkspace.shared.openApplication(at: url, configuration: config)
        return
    }
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

/// Diagnostic inventory only: never supplies roots or changes visibility policy.
/// No window titles, display names, UI content or screenshots leave this function.
func windowDiscoverySnapshot(scanBundleIds: [String]) -> [String: Any] {
    var diagnostics: [String: Any] = [:]
    let windows = listWindows(scanBundleIds: scanBundleIds) { diagnostics = $0 }
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    let pids = Set(apps.map { Int($0.processIdentifier) })
    let all = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]
    let candidates = (all ?? []).filter {
        pids.contains($0[kCGWindowOwnerPID as String] as? Int ?? 0)
            && ($0[kCGWindowLayer as String] as? Int) == 0
    }
    diagnostics["inventoryAvailable"] = all != nil
    diagnostics["candidateCount"] = candidates.count
    diagnostics["truncated"] = candidates.count > 80
    diagnostics["windows"] = candidates.prefix(80).map { row -> [String: Any] in
        let id = row[kCGWindowNumber as String] as? Int ?? 0
        return [
            "windowId": id,
            "pid": row[kCGWindowOwnerPID as String] as? Int ?? 0,
            "onScreen": row[kCGWindowIsOnscreen as String] as? Bool ?? false,
            "bounds": row[kCGWindowBounds as String] as? [String: Any] ?? [:],
            "returned": windows.contains { ($0["windowId"] as? Int) == id },
        ]
    }
    diagnostics["apps"] = apps.prefix(80).map { app -> [String: Any] in
        ["pid": Int(app.processIdentifier), "bundleId": app.bundleIdentifier ?? "",
         "hidden": app.isHidden, "active": app.isActive]
    }
    diagnostics["appCount"] = apps.count
    diagnostics["displays"] = NSScreen.screens.map { screen -> [String: Any] in
        let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        return ["id": String(id), "bounds": rectDict(CGDisplayBounds(id)), "scale": screen.backingScaleFactor]
    }
    return ["windows": windows, "diagnostics": diagnostics]
}
