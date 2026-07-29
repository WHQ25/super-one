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

private func encodeCapture(
    filter: SCContentFilter,
    bounds: CGRect,
    display: SCDisplay,
    kind: String,
    windowId: Int?,
    axRootId: String? = nil,
    sourceRect: CGRect? = nil,
    maxWidth: Int?,
    grantedBundleIds: [String],
    allowAllApps: Bool,
    excludedAppCount: Int
) async throws -> [String: Any] {
    let scale = backingScale(for: display)
    let naturalWidth = kind == "window" ? Double(bounds.width) * scale : Double(display.width)
    let naturalHeight = kind == "window" ? Double(bounds.height) * scale : Double(display.height)
    let size = captureSize(sourceWidth: naturalWidth, sourceHeight: naturalHeight, maxWidth: maxWidth)
    let cfg = SCStreamConfiguration()
    cfg.width = size.width
    cfg.height = size.height
    cfg.showsCursor = false
    cfg.captureResolution = .best
    if let sourceRect { cfg.sourceRect = sourceRect }
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
    allowAllApps: Bool
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
    let exclusion: [SCRunningApplication]
    if allowAllApps {
        exclusion = []
    } else {
        let granted = Set(grantedBundleIds)
        exclusion = content.applications.filter { !granted.contains($0.bundleIdentifier) }
    }
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
    targetWindowId: Int? = nil
) async throws -> [String: Any] {
    if !screenRecordingTrusted() {
        throw HelperError(
            code: "SCREEN_MISSING",
            message: "Screen Recording is not granted for \(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? Bundle.main.bundleIdentifier ?? "this helper") (pid \(ProcessInfo.processInfo.processIdentifier)). Enable it under System Settings → Privacy → Screen Recording for this exact app name, then fully quit SuperOne (dev restarts the helper). Grants do not apply to the process that was already running when you toggled the switch."
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

    let exclusion: [SCRunningApplication]
    if allowAllApps {
        exclusion = []
    } else {
        let granted = Set(grantedBundleIds)
        exclusion = content.applications.filter { app in
            !granted.contains(app.bundleIdentifier)
        }
    }

    let filter = SCContentFilter(display: display, excludingApplications: exclusion, exceptingWindows: [])
    return try await encodeCapture(
        filter: filter,
        bounds: display.frame,
        display: display,
        kind: "display",
        windowId: nil,
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
    allowAllApps: Bool
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
    let filter = SCContentFilter(desktopIndependentWindow: window)
    return try await encodeCapture(
        filter: filter,
        bounds: window.frame,
        display: display,
        kind: "window",
        windowId: windowId,
        maxWidth: maxWidth,
        grantedBundleIds: grantedBundleIds,
        allowAllApps: allowAllApps,
        excludedAppCount: 0
    )
}

func captureZoom(
    grantedBundleIds: [String],
    region: [Double],
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
    let full: [String: Any]
    if capture == "window" {
        if let axRootId, let pid {
            full = try await captureAxRoot(
                axRootId: axRootId,
                pid: pid,
                grantedBundleIds: grantedBundleIds,
                maxWidth: maxWidth,
                allowAllApps: allowAllApps
            )
        } else if let windowId {
            full = try await captureWindow(
                windowId: windowId,
                grantedBundleIds: grantedBundleIds,
                maxWidth: maxWidth,
                allowAllApps: allowAllApps
            )
        } else {
            throw HelperError(code: "INVALID", message: "window capture requires windowId or axRootId")
        }
    } else {
        full = try await captureDisplay(
            grantedBundleIds: grantedBundleIds,
            maxWidth: maxWidth,
            allowAllApps: allowAllApps,
            targetWindowId: windowId
        )
    }
    guard let dataB64 = full["data"] as? String,
          let data = Data(base64Encoded: dataB64),
          let provider = CGDataProvider(data: data as CFData),
          let source = CGImage(
            pngDataProviderSource: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
          ) else {
        throw HelperError(code: "DECODE", message: "Failed to decode capture for zoom")
    }
    let x0 = max(0, Int(region[0].rounded()))
    let y0 = max(0, Int(region[1].rounded()))
    let x1 = min(source.width, Int(region[2].rounded()))
    let y1 = min(source.height, Int(region[3].rounded()))
    let width = max(1, x1 - x0)
    let height = max(1, y1 - y0)
    guard let cropped = source.cropping(to: CGRect(x: x0, y: y0, width: width, height: height)),
          let png = cropped.pngData() else {
        throw HelperError(code: "CROP", message: "Failed to crop zoom region")
    }
    return [
        "mimeType": "image/png",
        "data": png.base64EncodedString(),
        "width": cropped.width,
        "height": cropped.height,
    ]
}

extension CGImage {
    func pngData() -> Data? {
        let rep = NSBitmapImageRep(cgImage: self)
        return rep.representation(using: .png, properties: [:])
    }
}
