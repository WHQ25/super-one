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

func listWindows(scanBundleIds: [String] = []) -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
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
        let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""
        let axMetadata = axTrusted() && windowId > 0
            ? try? resolveAxWindow(pid: pid_t(pid), windowId: windowId, windowTitle: title)
            : nil
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

    guard axTrusted() else { return roots }
    let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let apps = NSWorkspace.shared.runningApplications.filter {
        $0.activationPolicy == .regular && Int($0.processIdentifier) != selfPid
    }
    for app in apps {
        let pid = app.processIdentifier
        let cgRootCount = roots.filter { ($0["pid"] as? Int) == Int(pid) }.count
        let transients = discoverAxTransientRoots(
            pid: pid,
            includeDescendants: pid == frontPid
                || cgRootCount > 1
                || scanBundleIds.contains(app.bundleIdentifier ?? "")
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
    if activate { match.activate() }
}

/// Launch without frontmost activation so Computer Use can work in the background.
func launchApp(query: String, activate: Bool = false) throws {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query) {
        let config = NSWorkspace.OpenConfiguration()
        config.activates = activate
        NSWorkspace.shared.openApplication(at: url, configuration: config)
        return
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = activate
    if let url = NSWorkspace.shared.urlForApplication(
        toOpen: URL(fileURLWithPath: "/Applications/\(query).app")
    ) {
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
