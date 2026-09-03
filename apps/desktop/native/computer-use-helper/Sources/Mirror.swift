/**
 * iPhone Mirroring — macOS drawing a nearby iPhone into a window of its own.
 *
 * The third way SuperOne reaches a device, after a simulator and adb, and the only one
 * where the "device" is a window belonging to somebody else's app. Everything here is
 * about answering two questions the rest of the host cannot answer for itself: where
 * that window is, and whether what it is showing is actually the phone.
 *
 * The second question is the subtle one, and it has a surprising answer. A live
 * mirroring session exposes NO accessibility elements at all — the phone is a video
 * stream and AX cannot see into it. The screens macOS draws in that same window when
 * the session is not usable ("iPhone in Use", paused, ended, locked, connect) are
 * ordinary Mac views, so they come back with their labels and buttons intact. So the
 * PRESENCE of real UI is the signal that the session is blocked, and its absence is
 * the signal that the phone is live.
 *
 * Testing it that way rather than by matching known phrases is what makes this work on
 * a non-English system, and on whatever screen Apple adds next.
 *
 * Credit: the AX-emptiness test and the window-matching rules below were established
 * by phone-harness (MIT, © 2026 shawn pana), whose `mirror.py` documents each of the
 * traps they exist to avoid.
 */

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Never localized, unlike the window's owner name — see `findMirrorWindow`.
let MIRROR_BUNDLE_ID = "com.apple.ScreenContinuity"

/// macOS ships it here; absent below macOS 15.
let MIRROR_APP_PATH = "/System/Applications/iPhone Mirroring.app"

struct MirrorWindow {
    let windowId: Int
    let pid: pid_t
    let bounds: CGRect
}

func mirrorRunningApp() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(withBundleIdentifier: MIRROR_BUNDLE_ID).first
}

/**
 * The phone window, in screen points.
 *
 * Matched by the owning PID of the ScreenContinuity process, NEVER by the window's
 * owner name: macOS localizes that name — "iPhone镜像" on a Simplified Chinese system,
 * "iPhone鏡像輸出" on a Traditional Chinese one — so comparing against the English
 * string finds nothing and reports a permanently disconnected phone on any non-English
 * Mac. The bundle id is not localized.
 *
 * No size filter either, however tempting. A `width < 100` guard looks like it skips
 * panels and toolbars, but PID plus layer 0 has already excluded those; what such a
 * guard actually catches is a real mirroring window macOS has shrunk — with Stage
 * Manager on, an inactive window parks in the left rail at roughly 38x130. It is on
 * screen and it is genuinely the phone.
 *
 * The window list runs front to back, so the first candidate is the frontmost.
 */
func findMirrorWindow() -> MirrorWindow? {
    guard let app = mirrorRunningApp() else { return nil }
    let pid = app.processIdentifier
    let info = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    for window in info {
        guard window[kCGWindowOwnerPID as String] as? Int == Int(pid),
              (window[kCGWindowLayer as String] as? Int ?? 1) == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let windowId = window[kCGWindowNumber as String] as? Int else { continue }
        let rect = CGRect(
            x: bounds["X"] as? Double ?? 0,
            y: bounds["Y"] as? Double ?? 0,
            width: bounds["Width"] as? Double ?? 0,
            height: bounds["Height"] as? Double ?? 0
        )
        return MirrorWindow(windowId: windowId, pid: pid, bounds: rect)
    }
    return nil
}

/**
 * Native Mac UI drawn inside the mirroring window, as `[{role, text}]`.
 *
 * Empty means the phone is live. Non-empty means macOS has put one of its own screens
 * there and the caller should show its text rather than a picture — the strings are
 * already in the user's language, which is the whole reason to surface them instead of
 * a message of our own.
 *
 * Button titles are not dependable: the same screen reported "Connect" once and an
 * empty title a minute later. Callers that show this to a user should prefer the
 * AXStaticText entries.
 */
func mirrorInterstitial(_ window: MirrorWindow) -> [[String: String]] {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        axApplication(window.pid),
        kAXWindowsAttribute as CFString,
        &raw
    ) == .success, let windows = raw as? [AXUIElement] else { return [] }

    // Matched by geometry. The app also owns a Settings sheet and a Welcome dialog,
    // and counting their contents would report a healthy session as blocked.
    let target = windows.first { candidate in
        guard let position = axCGPoint(candidate, kAXPositionAttribute as String),
              let size = axCGSize(candidate, kAXSizeAttribute as String) else { return false }
        return abs(position.x - window.bounds.minX) < 4
            && abs(position.y - window.bounds.minY) < 4
            && abs(size.width - window.bounds.width) < 4
            && abs(size.height - window.bounds.height) < 4
    }
    guard let target else { return [] }

    var out: [[String: String]] = []
    func walk(_ node: AXUIElement, depth: Int) {
        // Bounded rather than exhaustive: these screens are half a dozen elements, and
        // an unbounded walk over a hostile tree is a hang in the middle of a probe the
        // device panel runs on a timer.
        if depth > 6 || out.count > 40 { return }
        let role = axRole(node)
        if ["AXStaticText", "AXButton", "AXTextField", "AXSecureTextField", "AXImage"].contains(role) {
            let text = [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute]
                .compactMap { axString(node, $0 as String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            out.append(["role": role, "text": text])
        }
        for child in axChildren(node) { walk(child, depth: depth + 1) }
    }
    walk(target, depth: 0)
    return out
}

/**
 * Everything the host needs to decide what to draw, in one round trip.
 *
 * Deliberately one call rather than "is it running" plus "where is the window" plus
 * "is it blocked": the device panel polls this, and three round trips per poll over a
 * socket is three chances for the answers to disagree with each other.
 */
func mirrorState() -> [String: Any] {
    let installed = FileManager.default.fileExists(atPath: MIRROR_APP_PATH)
    guard let window = findMirrorWindow() else {
        return [
            "installed": installed,
            "running": mirrorRunningApp() != nil,
            "live": false,
            "interstitial": [] as [[String: String]],
        ]
    }
    let interstitial = mirrorInterstitial(window)
    return [
        "installed": installed,
        "running": true,
        // The inversion this whole file is built on: no AX elements means the video
        // stream has the window, which means the phone is there.
        "live": interstitial.isEmpty,
        "interstitial": interstitial,
        "windowId": window.windowId,
        "pid": Int(window.pid),
        "bounds": [
            "x": window.bounds.minX,
            "y": window.bounds.minY,
            "width": window.bounds.width,
            "height": window.bounds.height,
        ],
    ]
}

/// Launch iPhone Mirroring without stealing the screen. Pairing may still bring it up.
func launchMirrorApp() throws {
    guard FileManager.default.fileExists(atPath: MIRROR_APP_PATH) else {
        throw HelperError(code: "NOT_INSTALLED", message: "iPhone Mirroring is not available on this system")
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    NSWorkspace.shared.openApplication(
        at: URL(fileURLWithPath: MIRROR_APP_PATH),
        configuration: configuration,
        completionHandler: nil
    )
}
