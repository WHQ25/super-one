import AppKit
import CoreGraphics
import Foundation

struct LiveWindowGeometry {
    let bounds: CGRect
    let pid: Int
    let bundleId: String
    let backingScale: Double
}

private func activeDisplay(for rect: CGRect) -> (bounds: CGRect, scale: Double)? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return nil }
    return ids.prefix(Int(count)).map { id in
        let bounds = CGDisplayBounds(id)
        let scale = Double(CGDisplayPixelsWide(id)) / max(Double(bounds.width), 1)
        return (bounds: bounds, scale: scale)
    }.max { lhs, rhs in
        lhs.bounds.intersection(rect).width * lhs.bounds.intersection(rect).height
            < rhs.bounds.intersection(rect).width * rhs.bounds.intersection(rect).height
    }
}

func liveWindowGeometry(windowId: Int) throws -> LiveWindowGeometry {
    let options: CGWindowListOption = [.optionIncludingWindow, .excludeDesktopElements]
    guard let rows = CGWindowListCopyWindowInfo(options, CGWindowID(windowId)) as? [[String: Any]],
          let row = rows.first,
          (row[kCGWindowNumber as String] as? Int) == windowId else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) no longer exists")
    }
    let onScreen = row[kCGWindowIsOnscreen as String] as? Bool ?? false
    let layer = row[kCGWindowLayer as String] as? Int ?? -1
    let alpha = row[kCGWindowAlpha as String] as? Double ?? 1
    guard onScreen, layer == 0, alpha > 0 else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) is hidden or minimized")
    }
    guard let raw = row[kCGWindowBounds as String] as? [String: Any] else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) has no bounds")
    }
    let bounds = CGRect(
        x: raw["X"] as? Double ?? 0,
        y: raw["Y"] as? Double ?? 0,
        width: raw["Width"] as? Double ?? 0,
        height: raw["Height"] as? Double ?? 0
    )
    guard bounds.width > 1, bounds.height > 1 else {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) has no visible area")
    }
    let pid = row[kCGWindowOwnerPID as String] as? Int ?? 0
    let bundleId = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleIdentifier ?? ""
    let scale = activeDisplay(for: bounds)?.scale ?? 1
    return LiveWindowGeometry(bounds: bounds, pid: pid, bundleId: bundleId, backingScale: scale)
}

func validateCoordinateGeometry(_ params: [String: Any]) throws -> LiveWindowGeometry? {
    guard AnyCodable.string(params, "coordinateKind") == "window" else { return nil }
    guard let windowId = AnyCodable.int(params, "coordinateWindowId")
        ?? AnyCodable.int(params, "windowId"),
          let expectedWidth = AnyCodable.double(params, "capturedWidth"),
          let expectedHeight = AnyCodable.double(params, "capturedHeight") else {
        throw HelperError(code: "INVALID", message: "Window coordinate metadata is incomplete")
    }
    let current = try liveWindowGeometry(windowId: windowId)
    if let targetPid = AnyCodable.int(params, "targetPid"), targetPid != current.pid {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) changed owner")
    }
    if let targetBundleId = AnyCodable.string(params, "targetBundleId"),
       !targetBundleId.isEmpty, targetBundleId != current.bundleId {
        throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) changed app")
    }
    let resized = abs(Double(current.bounds.width) - expectedWidth) > 0.5
        || abs(Double(current.bounds.height) - expectedHeight) > 0.5
    let scaleChanged = AnyCodable.double(params, "coordinateScale").map {
        abs(current.backingScale - $0) > 0.01
    } ?? false
    if resized || scaleChanged {
        throw HelperError(
            code: "WINDOW_GEOMETRY_CHANGED",
            message: "Window \(windowId) size or display scale changed; use the successor observation before sending more input"
        )
    }
    return current
}

func resolveCoordinatePoint(
    _ params: [String: Any],
    x: Double,
    y: Double,
    validatedWindow: LiveWindowGeometry? = nil
) throws -> CGPoint {
    guard let kind = AnyCodable.string(params, "coordinateKind") else {
        return CGPoint(x: x, y: y)
    }
    guard let coordinateWidth = AnyCodable.double(params, "coordinateWidth"),
          let coordinateHeight = AnyCodable.double(params, "coordinateHeight"),
          coordinateWidth > 0, coordinateHeight > 0 else {
        throw HelperError(code: "INVALID", message: "Coordinate space width/height are required")
    }
    guard x >= 0, x <= coordinateWidth, y >= 0, y <= coordinateHeight else {
        throw HelperError(
            code: "INVALID",
            message: "Point (\(x),\(y)) is outside the captured \(coordinateWidth)x\(coordinateHeight) space"
        )
    }
    let bounds: CGRect
    if kind == "window" {
        guard let current = try validatedWindow ?? validateCoordinateGeometry(params) else {
            throw HelperError(code: "INVALID", message: "Window geometry is required")
        }
        bounds = current.bounds
    } else {
        guard let x = AnyCodable.double(params, "capturedX"),
              let y = AnyCodable.double(params, "capturedY"),
              let width = AnyCodable.double(params, "capturedWidth"),
              let height = AnyCodable.double(params, "capturedHeight") else {
            throw HelperError(code: "INVALID", message: "Display capture bounds are required")
        }
        bounds = CGRect(x: x, y: y, width: width, height: height)
    }
    return CGPoint(
        x: bounds.minX + x * bounds.width / coordinateWidth,
        y: bounds.minY + y * bounds.height / coordinateHeight
    )
}
