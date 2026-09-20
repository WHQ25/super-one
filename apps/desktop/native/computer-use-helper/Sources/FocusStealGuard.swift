import AppKit
import CoreGraphics
import Foundation

/// Hand the front back to the user when an app being driven takes it.
///
/// Background input leaves the user's app in front, but the app it drives
/// can still activate itself for real: an Electron app opening a second
/// `BrowserWindow` does (`⌘⇧N` posted to a background probe put it in front
/// within a second), a save panel can, and so can anything an app decides
/// deserves attention. Nothing the user did asked for it, so the switch is
/// undone: the app that was in front before comes back.
///
/// Two things separate that from the user's own switch to the same app —
/// clicking its window, ⌘Tab, the Dock — which must stand and already drops
/// the app's synthetic activation lease. The app had been driven a moment
/// ago (an event posted to it, a lease held, an AX action performed), and
/// no HID input arrived just before the activation: the window server's own
/// idle clock does not count events posted to a pid, so it tells the user's
/// hand apart from the helper's.
///
/// Activations the helper asks for itself — `focus_app`/`launch_app` with
/// `activate`, `focus_window`, the real-activation fallback of a menu press
/// — are announced first and left alone.
enum FocusStealGuard {
    private static let lock = NSLock()
    /// When each app was last driven.
    private static var driven: [pid_t: Date] = [:]
    /// Apps the helper is about to activate on purpose, by pid or — for a
    /// launch, before there is a pid — by bundle id.
    private static var expected: [pid_t: Date] = [:]
    private static var expectedBundles: [String: Date] = [:]
    /// The app the user has in front, as of the last activation that was theirs.
    private static var userFront: NSRunningApplication?
    private static var observing = false

    /// How long after the last driven event an activation is still the app's
    /// doing: a panel or window can take a while to come up.
    static let drivenWindow: TimeInterval = 3
    /// HID input this recent means the user made the switch.
    static let userInputWindow: TimeInterval = 0.5
    private static let expectedWindow: TimeInterval = 5

    /// Called with every synthetic thing done to an app.
    static func noteDriven(pid: pid_t) {
        observe()
        lock.lock()
        driven[pid] = Date()
        lock.unlock()
    }

    /// Called before the helper activates an app for real.
    static func expectActivation(pid: pid_t) {
        observe()
        lock.lock()
        expected[pid] = Date()
        lock.unlock()
    }

    static func expectActivation(bundleId: String) {
        observe()
        lock.lock()
        expectedBundles[bundleId] = Date()
        lock.unlock()
    }

    /// Whether the user has touched the keyboard or a pointing device within
    /// `userInputWindow`. Reads the HID system state, which posted events do
    /// not update.
    static func userInputRecently(now: Date = Date()) -> Bool {
        let types: [CGEventType] = [
            .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel,
        ]
        for type in types where CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: type) < userInputWindow {
            return true
        }
        // Trackpad gestures (a Space swipe, Mission Control) have no public
        // event type; 29 is what the HID system reports them under.
        if let gesture = CGEventType(rawValue: 29),
           CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: gesture) < userInputWindow {
            return true
        }
        return false
    }

    private static func observe() {
        lock.lock()
        defer { lock.unlock() }
        guard !observing else { return }
        observing = true
        userFront = NSWorkspace.shared.frontmostApplication
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            didActivate(app)
        }
    }

    private static func didActivate(_ app: NSRunningApplication) {
        let pid = app.processIdentifier
        let now = Date()
        lock.lock()
        let askedFor = expected[pid] ?? app.bundleIdentifier.flatMap { expectedBundles[$0] }
        if let askedFor, now.timeIntervalSince(askedFor) < expectedWindow {
            expected[pid] = nil
            if let bundleId = app.bundleIdentifier { expectedBundles[bundleId] = nil }
            userFront = app
            lock.unlock()
            return
        }
        let recentlyDriven = driven[pid].map { now.timeIntervalSince($0) < drivenWindow } ?? false
        let previous = userFront
        let stolen = recentlyDriven && !userInputRecently(now: now)
            && previous != nil && previous?.processIdentifier != pid && previous?.isTerminated == false
        if !stolen { userFront = app }
        lock.unlock()
        guard stolen, let previous else { return }
        FileHandle.standardError.write(Data(
            "[superone-cu-helper] \(app.localizedName ?? String(pid)) took the front while driven; returning it to \(previous.localizedName ?? "the user's app")\n".utf8
        ))
        previous.activate()
    }
}
