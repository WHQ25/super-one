import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

func rectDict(_ rect: CGRect) -> [String: Double] {
    [
        "x": Double(rect.minX),
        "y": Double(rect.minY),
        "width": Double(rect.width),
        "height": Double(rect.height),
    ]
}

private func bestDisplay(for rect: CGRect, in displays: [SCDisplay]) -> SCDisplay? {
    displays.max { lhs, rhs in
        lhs.frame.intersection(rect).width * lhs.frame.intersection(rect).height
            < rhs.frame.intersection(rect).width * rhs.frame.intersection(rect).height
    }
}

private func backingScale(for display: SCDisplay) -> Double {
    Double(display.width) / max(Double(display.frame.width), 1)
}

/// Privacy UI owned by this helper (for example Picture in Picture) must never
/// appear in a display capture, even when the user allows all target apps.
private func captureExclusions(
    content: SCShareableContent,
    grantedBundleIds: [String],
    allowAllApps: Bool
) -> [SCRunningApplication] {
    let helperBundleId = Bundle.main.bundleIdentifier
    let granted = Set(grantedBundleIds)
    return content.applications.filter { app in
        if app.bundleIdentifier == helperBundleId { return true }
        return !allowAllApps && !granted.contains(app.bundleIdentifier)
    }
}

private func captureSize(
    sourceWidth: Double,
    sourceHeight: Double,
    maxWidth: Int?
) -> (width: Int, height: Int) {
    var width = max(1, Int(sourceWidth.rounded()))
    var height = max(1, Int(sourceHeight.rounded()))
    if let maxWidth, maxWidth > 0, max(width, height) > maxWidth {
        let ratio = Double(maxWidth) / Double(max(width, height))
        width = max(1, Int((Double(width) * ratio).rounded()))
        height = max(1, Int((Double(height) * ratio).rounded()))
    }
    return (width, height)
}

/// A part of a capture, in points local to the captured bounds, taken at the
/// display's real pixel scale: `SCDisplay.width` is in points, so the scale
/// `backingScale` derives from it is 1 and a whole capture is logical-size.
/// A zoom is the one capture that has to show more than the observation did.
struct DetailCrop {
    let rect: CGRect
    let pixelScale: Double
}

private func encodeCapture(
    filter: SCContentFilter,
    bounds: CGRect,
    display: SCDisplay,
    kind: String,
    windowId: Int?,
    axRootId: String? = nil,
    sourceRect: CGRect? = nil,
    detail: DetailCrop? = nil,
    maxWidth: Int?,
    grantedBundleIds: [String],
    allowAllApps: Bool,
    excludedAppCount: Int
) async throws -> [String: Any] {
    let scale = detail?.pixelScale ?? backingScale(for: display)
    let naturalWidth: Double
    let naturalHeight: Double
    var captureRect = sourceRect
    if let detail {
        naturalWidth = Double(detail.rect.width) * scale
        naturalHeight = Double(detail.rect.height) * scale
        captureRect = detail.rect.offsetBy(dx: sourceRect?.minX ?? 0, dy: sourceRect?.minY ?? 0)
    } else {
        naturalWidth = kind == "window" ? Double(bounds.width) * scale : Double(display.width)
        naturalHeight = kind == "window" ? Double(bounds.height) * scale : Double(display.height)
    }
    let size = captureSize(sourceWidth: naturalWidth, sourceHeight: naturalHeight, maxWidth: maxWidth)
    let cfg = SCStreamConfiguration()
    cfg.width = size.width
    cfg.height = size.height
    cfg.showsCursor = false
    cfg.captureResolution = .best
    if let captureRect { cfg.sourceRect = captureRect }
    if kind == "window" {
        cfg.ignoreShadowsSingleWindow = true
    }

    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
    guard let png = image.pngData() else {
        throw HelperError(code: "ENCODE", message: "Failed to encode PNG")
    }
    var coordinateSpace: [String: Any] = [
        "width": image.width,
        "height": image.height,
        "scale": scale,
        "fullScreen": kind == "display",
        "kind": kind,
        "capturedBounds": rectDict(bounds),
        "displayBounds": rectDict(display.frame),
    ]
    if let windowId { coordinateSpace["windowId"] = windowId }
    if let axRootId { coordinateSpace["axRootId"] = axRootId }

    return [
        "mimeType": "image/png",
        "data": png.base64EncodedString(),
        "width": image.width,
        "height": image.height,
        "coordinateSpace": coordinateSpace,
        "grantedBundleIds": allowAllApps ? ["*"] : grantedBundleIds,
        "allowAllApps": allowAllApps,
        "excludedAppCount": excludedAppCount,
    ]
}

func captureAxRoot(
    axRootId: String,
    pid: pid_t,
    grantedBundleIds: [String],
    maxWidth: Int?,
    allowAllApps: Bool,
    detail: DetailCrop? = nil
) async throws -> [String: Any] {
    if !screenRecordingTrusted() {
        throw HelperError(code: "SCREEN_MISSING", message: "Screen Recording is not granted for Computer Use helper")
    }
    let geometry = try liveAxRootGeometry(id: axRootId, pid: pid)
    if !allowAllApps && !grantedBundleIds.contains(geometry.bundleId) {
        throw HelperError(code: "NOT_GRANTED", message: "AX root \(axRootId) does not belong to a granted app")
    }

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = bestDisplay(for: geometry.bounds, in: content.displays) else {
        throw HelperError(code: "NO_DISPLAY", message: "No display contains AX root \(axRootId)")
    }
    let bounds = geometry.bounds.intersection(display.frame)
    guard bounds.width > 1, bounds.height > 1 else {
        throw HelperError(code: "AX_ROOT_NOT_FOUND", message: "AX root \(axRootId) has no capturable area")
    }
    let exclusion = captureExclusions(
        content: content,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps
    )
    let filter = SCContentFilter(display: display, excludingApplications: exclusion, exceptingWindows: [])
    let localBounds = CGRect(
        x: bounds.minX - display.frame.minX,
        y: bounds.minY - display.frame.minY,
        width: bounds.width,
        height: bounds.height
    )
    return try await encodeCapture(
        filter: filter,
        bounds: bounds,
        display: display,
        kind: "window",
        windowId: nil,
        axRootId: axRootId,
        sourceRect: localBounds,
        detail: detail,
        maxWidth: maxWidth,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps,
        excludedAppCount: exclusion.count
    )
}

func captureDisplay(
    grantedBundleIds: [String],
    maxWidth: Int?,
    allowAllApps: Bool,
    targetWindowId: Int? = nil,
    detail: DetailCrop? = nil
) async throws -> [String: Any] {
    if !screenRecordingTrusted() {
        throw HelperError(
            code: "SCREEN_MISSING",
            message: "Screen Recording is not granted for \(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? Bundle.main.bundleIdentifier ?? "this helper") (pid \(ProcessInfo.processInfo.processIdentifier)). Enable it under System Settings → Privacy → Screen Recording for this exact app name, then request permissions again in SuperOne Settings so the helper restarts. Grants do not apply to the process that was already running when you toggled the switch."
        )
    }

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let targetWindow = targetWindowId.flatMap { id in
        content.windows.first(where: { Int($0.windowID) == id })
    }
    guard let display = targetWindow.flatMap({ bestDisplay(for: $0.frame, in: content.displays) })
        ?? content.displays.first else {
        throw HelperError(code: "NO_DISPLAY", message: "No shareable display")
    }

    let exclusion = captureExclusions(
        content: content,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps
    )

    let filter = SCContentFilter(display: display, excludingApplications: exclusion, exceptingWindows: [])
    return try await encodeCapture(
        filter: filter,
        bounds: display.frame,
        display: display,
        kind: "display",
        windowId: nil,
        detail: detail,
        maxWidth: maxWidth,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps,
        excludedAppCount: exclusion.count
    )
}

func captureWindow(
    windowId: Int,
    grantedBundleIds: [String],
    maxWidth: Int?,
    allowAllApps: Bool,
    detail: DetailCrop? = nil
) async throws -> [String: Any] {
    if !screenRecordingTrusted() {
        throw HelperError(code: "SCREEN_MISSING", message: "Screen Recording is not granted for Computer Use helper")
    }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { Int($0.windowID) == windowId }), window.isOnScreen else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) is no longer visible")
    }
    let bundleId = window.owningApplication?.bundleIdentifier ?? ""
    if !allowAllApps && !grantedBundleIds.contains(bundleId) {
        throw HelperError(code: "NOT_GRANTED", message: "Window \(windowId) does not belong to a granted app")
    }
    guard window.frame.width > 1, window.frame.height > 1 else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) has no capturable area")
    }
    guard let display = bestDisplay(for: window.frame, in: content.displays) else {
        throw HelperError(code: "NO_DISPLAY", message: "No display contains window \(windowId)")
    }
    // A detail crop goes through a display filter that shows only this
    // window: `sourceRect` on a window filter is window-relative until a
    // stream on the same window exists (the viewfinder's mirror), when it
    // turns display-relative; a display filter reads it as display-relative
    // either way.
    let filter = detail == nil
        ? SCContentFilter(desktopIndependentWindow: window)
        : SCContentFilter(display: display, including: [window])
    let localBounds = detail == nil ? nil : CGRect(
        x: window.frame.minX - display.frame.minX,
        y: window.frame.minY - display.frame.minY,
        width: window.frame.width,
        height: window.frame.height
    )
    return try await encodeCapture(
        filter: filter,
        bounds: window.frame,
        display: display,
        kind: "window",
        windowId: windowId,
        sourceRect: localBounds,
        detail: detail,
        maxWidth: maxWidth,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps,
        excludedAppCount: 0
    )
}

/// `region` is in the parent observation's capture space, `parentWidth` ×
/// `parentHeight` (the captured bounds when nothing was downscaled); nil
/// means the region is already in points of the captured bounds.
func captureZoom(
    grantedBundleIds: [String],
    region: [Double],
    parentWidth: Double?,
    parentHeight: Double?,
    allowAllApps: Bool,
    maxWidth: Int?,
    capture: String,
    windowId: Int?,
    axRootId: String? = nil,
    pid: pid_t? = nil
) async throws -> [String: Any] {
    guard region.count == 4 else {
        throw HelperError(code: "INVALID", message: "region must be [x0,y0,x1,y1]")
    }
    let bounds: CGRect
    if capture == "window" {
        if let axRootId, let pid {
            bounds = try liveAxRootGeometry(id: axRootId, pid: pid).bounds
        } else if let windowId {
            bounds = try liveWindowGeometry(windowId: windowId).bounds
        } else {
            throw HelperError(code: "INVALID", message: "window capture requires windowId or axRootId")
        }
    } else {
        guard let display = activeDisplay(for: (try? liveWindowGeometry(windowId: windowId ?? 0))?.bounds ?? .zero)
            ?? activeDisplay(for: CGRect(x: 0, y: 0, width: 1, height: 1)) else {
            throw HelperError(code: "NO_DISPLAY", message: "No active display")
        }
        bounds = display.bounds
    }
    let factorX = Double(bounds.width) / max(parentWidth ?? Double(bounds.width), 1)
    let factorY = Double(bounds.height) / max(parentHeight ?? Double(bounds.height), 1)
    let x0 = min(max(0, region[0] * factorX), Double(bounds.width))
    let y0 = min(max(0, region[1] * factorY), Double(bounds.height))
    let x1 = min(max(0, region[2] * factorX), Double(bounds.width))
    let y1 = min(max(0, region[3] * factorY), Double(bounds.height))
    guard x1 - x0 >= 1, y1 - y0 >= 1 else {
        throw HelperError(code: "INVALID", message: "region is empty or outside the capture")
    }
    let detail = DetailCrop(
        rect: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0),
        pixelScale: displayPixelScale(for: bounds)
    )
    let full: [String: Any]
    if capture == "window" {
        if let axRootId, let pid {
            full = try await captureAxRoot(
                axRootId: axRootId,
                pid: pid,
                grantedBundleIds: grantedBundleIds,
                maxWidth: maxWidth,
                allowAllApps: allowAllApps,
                detail: detail
            )
        } else {
            full = try await captureWindow(
                windowId: windowId!,
                grantedBundleIds: grantedBundleIds,
                maxWidth: maxWidth,
                allowAllApps: allowAllApps,
                detail: detail
            )
        }
    } else {
        full = try await captureDisplay(
            grantedBundleIds: grantedBundleIds,
            maxWidth: maxWidth,
            allowAllApps: allowAllApps,
            targetWindowId: windowId,
            detail: detail
        )
    }
    return [
        "mimeType": "image/png",
        "data": full["data"] as Any,
        "width": full["width"] as Any,
        "height": full["height"] as Any,
    ]
}

extension CGImage {
    func pngData() -> Data? {
        let rep = NSBitmapImageRep(cgImage: self)
        return rep.representation(using: .png, properties: [:])
    }
}
