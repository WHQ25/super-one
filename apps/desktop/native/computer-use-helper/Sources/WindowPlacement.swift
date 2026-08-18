import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func handleWindowPlacementCommand(
    _ method: String,
    params: [String: Any]
) throws -> [String: Any] {
    switch method {
    case "display_place_window":
        guard let windowId = AnyCodable.int(params, "windowId"),
              let pid = AnyCodable.int(params, "pid"),
              let displayId = AnyCodable.string(params, "displayId"),
              !displayId.isEmpty else {
            throw HelperError(
                code: "INVALID",
                message: "display_place_window requires windowId, pid, and displayId"
            )
        }
        return try WindowPlacementController.shared.place(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            windowId: windowId,
            pid: pid_t(pid),
            title: AnyCodable.string(params, "title"),
            displayId: displayId
        )
    case "display_restore_session":
        let sessionId = AnyCodable.string(params, "sessionId") ?? ""
        guard !sessionId.isEmpty else {
            throw HelperError(code: "INVALID", message: "display_restore_session requires sessionId")
        }
        let count = WindowPlacementController.shared.restore(sessionId: sessionId)
        return ["ok": true, "restored": count]
    case "display_restore_all":
        let count = WindowPlacementController.shared.restoreAll()
        return ["ok": true, "restored": count]
    default:
        throw HelperError(code: "UNKNOWN_METHOD", message: method)
    }
}

private struct WindowPlacement {
    let sessionId: String
    let windowId: Int
    let targetDisplayId: CGDirectDisplayID
    let element: AXUIElement
    let originalFrame: CGRect
}

final class WindowPlacementController {
    static let shared = WindowPlacementController()

    private let lock = NSLock()
    private var placements: [Int: WindowPlacement] = [:]
    private var screenObserver: NSObjectProtocol?

    private init() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.screenObserver == nil else { return }
            self.screenObserver = NotificationCenter.default.addObserver(
                forName: NSApplication.didChangeScreenParametersNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                // Restore first. The next Computer Use observation can move the
                // window again after display geometry has settled.
                _ = self?.restoreAll()
            }
        }
    }

    func place(
        sessionId: String,
        windowId: Int,
        pid: pid_t,
        title: String?,
        displayId rawDisplayId: String
    ) throws -> [String: Any] {
        guard !sessionId.isEmpty else {
            throw HelperError(code: "INVALID", message: "display placement requires sessionId")
        }
        guard axTrusted() else {
            throw HelperError(code: "AX_MISSING", message: "Accessibility permission is required")
        }

        lock.lock()
        defer { lock.unlock() }

        guard let displayId = parseDisplayId(rawDisplayId),
              let screen = screen(for: displayId) else {
            throw HelperError(code: "DISPLAY_UNAVAILABLE", message: "Display \(rawDisplayId) is unavailable")
        }

        let metadata = try resolveAxWindow(pid: pid, windowId: windowId, windowTitle: title)
        guard let currentFrame = axFrame(metadata.element), currentFrame.width > 1, currentFrame.height > 1 else {
            throw HelperError(code: "AX_WINDOW_NOT_FOUND", message: "Window \(windowId) has no movable frame")
        }
        let targetFrame = screenStateVisibleFrame(screen: screen, displayId: displayId)
        guard targetFrame.width > 1, targetFrame.height > 1 else {
            throw HelperError(code: "DISPLAY_UNAVAILABLE", message: "Display \(rawDisplayId) has no usable area")
        }

        let existing = placements[windowId]
        if existing?.sessionId == sessionId,
           existing?.targetDisplayId == displayId,
           mostlyContained(currentFrame, in: targetFrame) {
            return ["ok": true, "moved": false, "bounds": rectDict(currentFrame)]
        }
        if existing == nil, mostlyContained(currentFrame, in: targetFrame) {
            return ["ok": true, "moved": false, "bounds": rectDict(currentFrame)]
        }

        let originalFrame = existing?.originalFrame ?? currentFrame
        let destination = CGPoint(
            x: targetFrame.minX + max(0, (targetFrame.width - currentFrame.width) / 2),
            y: targetFrame.minY + max(0, (targetFrame.height - currentFrame.height) / 2)
        )
        try setPosition(destination, for: metadata.element, windowId: windowId)
        let movedFrame = axFrame(metadata.element)
            ?? CGRect(origin: destination, size: currentFrame.size)

        placements[windowId] = WindowPlacement(
            sessionId: sessionId,
            windowId: windowId,
            targetDisplayId: displayId,
            element: metadata.element,
            originalFrame: originalFrame
        )
        return ["ok": true, "moved": true, "bounds": rectDict(movedFrame)]
    }

    @discardableResult
    func restore(sessionId: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let targets = placements.values.filter { $0.sessionId == sessionId }
        for target in targets { placements.removeValue(forKey: target.windowId) }
        restore(targets)
        return targets.count
    }

    @discardableResult
    func restoreAll() -> Int {
        lock.lock()
        defer { lock.unlock() }
        let targets = Array(placements.values)
        placements.removeAll()
        restore(targets)
        return targets.count
    }

    func restoreAllImmediately() {
        _ = restoreAll()
    }

    private func restore(_ targets: [WindowPlacement]) {
        for target in targets {
            let origin = safeRestoreOrigin(for: target.originalFrame)
            try? setPosition(origin, for: target.element, windowId: target.windowId)
        }
    }
}

private func parseDisplayId(_ raw: String) -> CGDirectDisplayID? {
    guard let value = Int64(raw) else { return nil }
    return CGDirectDisplayID(truncatingIfNeeded: value)
}

private func screen(for displayId: CGDirectDisplayID) -> NSScreen? {
    NSScreen.screens.first { screen in
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        guard let number = screen.deviceDescription[key] as? NSNumber else { return false }
        return number.uint32Value == displayId
    }
}

private func screenStateVisibleFrame(screen: NSScreen, displayId: CGDirectDisplayID) -> CGRect {
    let displayFrame = CGDisplayBounds(displayId)
    let screenFrame = screen.frame
    let visible = screen.visibleFrame
    return CGRect(
        x: displayFrame.minX + visible.minX - screenFrame.minX,
        y: displayFrame.minY + screenFrame.maxY - visible.maxY,
        width: visible.width,
        height: visible.height
    )
}

private func mostlyContained(_ window: CGRect, in display: CGRect) -> Bool {
    let intersection = window.intersection(display)
    guard !intersection.isNull else { return false }
    let windowArea = max(window.width * window.height, 1)
    return intersection.width * intersection.height >= windowArea * 0.8
}

private func safeRestoreOrigin(for frame: CGRect) -> CGPoint {
    let displayFrames = NSScreen.screens.compactMap { screen -> CGRect? in
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        guard let number = screen.deviceDescription[key] as? NSNumber else { return nil }
        return CGDisplayBounds(CGDirectDisplayID(number.uint32Value))
    }
    if displayFrames.contains(where: { !$0.intersection(frame).isNull }) {
        return frame.origin
    }
    guard let primary = NSScreen.screens.first(where: { $0.frame.origin == .zero })
        ?? NSScreen.screens.first,
        let number = primary.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
        return frame.origin
    }
    let visible = screenStateVisibleFrame(
        screen: primary,
        displayId: CGDirectDisplayID(number.uint32Value)
    )
    return CGPoint(
        x: visible.minX + max(0, (visible.width - frame.width) / 2),
        y: visible.minY + max(0, (visible.height - frame.height) / 2)
    )
}

private func setPosition(
    _ point: CGPoint,
    for element: AXUIElement,
    windowId: Int
) throws {
    var settable = DarwinBoolean(false)
    let settableError = AXUIElementIsAttributeSettable(
        element,
        kAXPositionAttribute as CFString,
        &settable
    )
    guard settableError == .success, settable.boolValue else {
        throw HelperError(code: "WINDOW_NOT_MOVABLE", message: "Window \(windowId) cannot be moved")
    }
    var destination = point
    guard let value = AXValueCreate(.cgPoint, &destination) else {
        throw HelperError(code: "BACKEND", message: "Failed to encode window position")
    }
    let error = AXUIElementSetAttributeValue(
        element,
        kAXPositionAttribute as CFString,
        value
    )
    guard error == .success else {
        throw HelperError(code: "WINDOW_NOT_MOVABLE", message: "Failed to move window \(windowId): \(error.rawValue)")
    }
}
