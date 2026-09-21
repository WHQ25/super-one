import AppKit
import CoreGraphics
import Foundation

/// The window the window server would hand a drop at `point` to.
///
/// Posted pointer events are routed to a window by number (fields 51/91/92),
/// so they reach a background window under anything. A drag is different:
/// once the source app has begun its dragging session, the drag manager
/// hit-tests the drag location against the real on-screen stacking order and
/// the frontmost window at that point becomes the drop destination — the
/// source app's belief about being active does not enter into it. A drop
/// point under another app's window is delivered to that window; an uncovered
/// one lands in the background, within a window or across two. Read the same
/// list the drag manager does, front to back, and report the first ordinary
/// window at the point when it is not the one the drop was aimed at.
struct WindowCover {
    let windowId: Int
    let pid: Int
    let app: String
}

/// Ordinary windows (layer 0) only: menu bar, Dock and the desktop are at
/// other levels and take no drops; the helper's own overlay windows are
/// click-through and never a destination.
func coveringWindows(of windowId: Int, at points: [CGPoint]) -> [WindowCover?] {
    guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] else {
        return points.map { _ in nil }
    }
    let own = Int(getpid())
    let candidates: [(id: Int, pid: Int, app: String, bounds: CGRect)] = rows.compactMap { row in
        guard (row[kCGWindowLayer as String] as? Int) == 0,
              (row[kCGWindowAlpha as String] as? Double ?? 1) > 0,
              let id = row[kCGWindowNumber as String] as? Int,
              let pid = row[kCGWindowOwnerPID as String] as? Int, pid != own,
              let raw = row[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return nil }
        return (id, pid, row[kCGWindowOwnerName as String] as? String ?? "", bounds)
    }
    return points.map { point in
        guard let top = candidates.first(where: { $0.bounds.contains(point) }), top.id != windowId else { return nil }
        return WindowCover(windowId: top.id, pid: top.pid, app: top.app)
    }
}

/// `[[x,y], ...]` or `[{x,y}, ...]`, as the drag and cover requests carry points.
func pathPoints(_ params: [String: Any], key: String, minimum: Int) throws -> [CGPoint] {
    guard let raw = params[key] as? [Any], raw.count >= minimum else {
        throw HelperError(code: "INVALID", message: "\(key) needs ≥\(minimum) points")
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
    return try raw.map { item in
        guard let point = pointFrom(item) else {
            throw HelperError(code: "INVALID", message: "\(key) point must be {x,y} or [x,y]")
        }
        return point
    }
}
