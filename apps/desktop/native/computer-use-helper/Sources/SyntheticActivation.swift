import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Make a background app believe it is the active app, without activating it.
///
/// Two things gate a menu command or a ⌘ shortcut inside AppKit: the app's own
/// `isActive`, and a key window for the menu validation to run against. Both
/// are normally set from notifications the window server sends the app when the
/// user activates it. Neither is the window server's front-process record,
/// which is what puts an app's menu bar on screen and routes real input to it.
///
/// So the two can be split: post the app the same AppKit-defined
/// `ApplicationActivated` event the window server would, then a synthetic
/// click routed to its window (a mouse-down is what makes a window key), and
/// the app runs its foreground logic — menus validate, `AXPress` on a command
/// works, a ⌘S posted to its pid opens the save sheet, a click posted to a
/// text view places the caret — while the user's app stays in front and
/// nothing on screen changes. `ApplicationDeactivated` afterwards puts the
/// app back; without it the app is left believing it is active, and a later
/// real activation no longer establishes a key window (seen on TextEdit:
/// even a foreground ⌘S then did nothing until relaunch).
///
/// This is how Codex Computer Use does it (`SyntheticAppFocusEnforcer`). The
/// event shapes are AppKit's own but undocumented; every step is verified
/// through AX (`AXFocusedWindow` appears), and a caller that gets `nil` falls
/// back to a real activation.
struct SyntheticActivation {
    let pid: pid_t
    let windowId: CGWindowID

    private static let keyWindowTimeout: TimeInterval = 0.4
    /// How far left of the close button the key-making click lands when the
    /// window has no title label: on the frame, clear of the button.
    private static let closeButtonClearance: CGFloat = 6

    /// Returns nil when the app is already the real frontmost app (nothing to
    /// do), has no window to make key, or never reports a focused window — the
    /// caller then activates for real.
    static func activate(pid: pid_t, windowId: CGWindowID?) -> SyntheticActivation? {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return nil }
        guard let windowId = windowId ?? frontWindow(of: pid) else { return nil }
        let activation = SyntheticActivation(pid: pid, windowId: windowId)
        activation.post(appKitSubtype: .applicationActivated)
        activation.postKeyMakingClick()
        // The app processes the events on its main thread, which also answers
        // AX requests; probing it before it has had a moment delays the very
        // thing being waited for. `AXFrontmost` is the app's own belief, so it
        // flips only once the activation event has been processed; a focused
        // window then says the click made one key.
        let app = AXUIElementCreateApplication(pid)
        let deadline = Date().addingTimeInterval(keyWindowTimeout)
        usleep(30_000)
        while Date() < deadline {
            if axBool(app, kAXFrontmostAttribute as String) == true,
               axAttributeElement(app, kAXFocusedWindowAttribute as String) != nil {
                return activation
            }
            usleep(20_000)
        }
        activation.deactivate()
        return nil
    }

    /// Tell the app it is no longer active — unless it really is by now, in
    /// which case the window server's own notification is the truth. Told
    /// otherwise, an app that has just been activated for real deactivates
    /// itself and hands the front back: Finder, activated for a physical
    /// click two seconds after a background right-click, was behind Electron
    /// again by the time the click came.
    func deactivate() {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return }
        if NSRunningApplication(processIdentifier: pid)?.isActive == true { return }
        post(appKitSubtype: .applicationDeactivated)
    }

    private func post(appKitSubtype subtype: NSEvent.EventSubtype) {
        guard let event = NSEvent.otherEvent(
            with: .appKitDefined, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: Int(windowId), context: nil, subtype: Int16(subtype.rawValue), data1: 0, data2: 0
        )?.cgEvent else { return }
        event.postToPid(pid)
    }

    /// The mouse-down that makes the window key has to land on a view. One
    /// that hits nothing — posted off screen, or on the rounded corner of the
    /// frame — still makes the window key, but AppKit keeps it and delivers
    /// it to the first responder after the next click: a caret placed by a
    /// click into TextEdit's text view jumped to the start of the text, and
    /// a drag-selection collapsed the same way. A click on the window's title
    /// label, or on the frame just left of the close button, is handled by
    /// the title bar as a window drag that never moves and is not replayed.
    ///
    /// A web view (Chromium: Chrome, Electron; WebKit) is the exception that
    /// needs the off-screen click. Its content refuses first mouse, so with
    /// no frame to click the first click posted into it is swallowed to make
    /// the window key and never reaches the page — a click into an input did
    /// not focus it, typing went nowhere, a button did nothing until clicked
    /// again. Chromium windows have no title label, and with a hidden title
    /// bar (Electron `hiddenInset`, SuperOne, Cursor) the strip beside the
    /// traffic lights is web content too, where a click is a drag-region
    /// press that makes nothing key. The off-screen click makes such a window
    /// key, and Chromium does not replay it: the next click into a button
    /// fires once, a drag-selection holds.
    ///
    /// A window with none of these gets no click: its first real click makes
    /// it key by itself, swallowed only by a view that refuses first mouse.
    private func postKeyMakingClick() {
        guard let point = keyMakingPoint(),
              let window = try? liveWindowGeometry(windowId: Int(windowId)) else { return }
        for (type, pressure) in [(NSEvent.EventType.leftMouseDown, Float(1)), (.leftMouseUp, 0)] {
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: Int(windowId), context: nil, eventNumber: 1, clickCount: 1, pressure: pressure
            )?.cgEvent else { continue }
            event.location = point
            routeToWindow(event, at: point, window: PointerWindow(id: windowId, bounds: window.bounds))
            event.postToPid(pid)
            usleep(30_000)
        }
    }

    private func keyMakingPoint() -> CGPoint? {
        guard let window = try? resolveAxWindow(pid: pid, windowId: Int(windowId)),
              let bounds = axFrame(window.element) else { return nil }
        if let title = axAttributeElement(window.element, kAXTitleUIElementAttribute as String),
           let frame = axFrame(title), frame.width > 0, frame.height > 0, bounds.contains(frame) {
            return CGPoint(x: frame.midX, y: frame.midY)
        }
        let closeButton = axChildren(window.element).first {
            axString($0, kAXSubroleAttribute as String) == kAXCloseButtonSubrole
        }
        // Only the frame handles this click as a title-bar press: under a
        // hidden title bar the same point is content (Cursor's traffic lights
        // sit 14 pt in, over its web view), so ask what is there first.
        if let closeButton, let frame = axFrame(closeButton),
           frame.minX - bounds.minX >= Self.closeButtonClearance * 2 {
            let point = CGPoint(x: frame.minX - Self.closeButtonClearance, y: frame.midY)
            if let hit = axElementAt(pid: pid, point: point), CFEqual(hit, window.element) {
                return point
            }
        }
        if hostsWebArea(window.element) { return Self.offScreenPoint }
        return nil
    }

    /// Where a click hits nothing: off every display, so no view of the
    /// window — or of anything else — is under it.
    private static let offScreenPoint = CGPoint(x: -5000, y: -5000)
    private static let webAreaSearchBudget = 200

    /// Whether the window's content is a web view. Breadth-first, because the
    /// web area sits a few levels down (Electron: right under the content
    /// group; Chrome: below the tab strip and toolbar) while the tree beneath
    /// it is unbounded; the budget keeps a native window's walk short.
    private func hostsWebArea(_ window: AXUIElement) -> Bool {
        var queue = axChildren(window)
        var visited = 0
        while !queue.isEmpty, visited < Self.webAreaSearchBudget {
            let element = queue.removeFirst()
            visited += 1
            if axRole(element) == "AXWebArea" { return true }
            queue.append(contentsOf: axChildren(element))
        }
        return false
    }

    /// The app's frontmost normal-layer window, front to back as the window
    /// server lists them.
    private static func frontWindow(of pid: pid_t) -> CGWindowID? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        for info in list {
            guard let owner = info[kCGWindowOwnerPID as String] as? Int, owner == Int(pid),
                  let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
                  let number = info[kCGWindowNumber as String] as? Int else { continue }
            return CGWindowID(number)
        }
        return nil
    }
}

/// Per-app leases on a synthetic activation.
///
/// AppKit serves menu validation from a cache for ~0.85s, so the walk that
/// observed a background app's menus (every command disabled) and the press
/// that follows within a second would otherwise disagree, and the press waits
/// for the cache to expire. Holding the belief across the requests of one
/// interaction — the observation's menu walk, the press, the shortcut — means
/// every validation runs against the same active state, the observed flags
/// are the real ones, and a press is immediate. The belief is withdrawn after
/// the requests stop, or dropped silently when the user activates the app for
/// real and the window server's own notifications take over.
enum SyntheticActivationLease {
    private static let lock = NSLock()
    private static var held: [pid_t: (activation: SyntheticActivation, generation: Int)] = [:]
    private static var generation = 0
    private static var observing = false
    private static let idle: TimeInterval = 2.0

    /// True when the app now believes it is active, freshly or already.
    @discardableResult
    static func hold(pid: pid_t, windowId: CGWindowID?) -> Bool {
        observeRealActivation()
        lock.lock()
        if let current = held[pid] {
            generation += 1
            held[pid] = (current.activation, generation)
            scheduleRelease(pid: pid, generation: generation)
            lock.unlock()
            return true
        }
        lock.unlock()
        guard let activation = SyntheticActivation.activate(pid: pid, windowId: windowId) else { return false }
        lock.lock()
        generation += 1
        held[pid] = (activation, generation)
        scheduleRelease(pid: pid, generation: generation)
        lock.unlock()
        return true
    }

    /// Released on the main queue, where the real-activation observer runs,
    /// so a lease the user's activation has already dropped is never released
    /// a moment later with a deactivation the app should not hear.
    private static func scheduleRelease(pid: pid_t, generation: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + idle) {
            lock.lock()
            guard let current = held[pid], current.generation == generation else { lock.unlock(); return }
            // A menu the app opened under this belief — a context menu from a
            // background right-click — closes the moment the app hears it is
            // no longer active. It is there to be read and pressed; keep the
            // belief until it has gone.
            if hasOpenMenu(pid: pid) {
                lock.unlock()
                scheduleRelease(pid: pid, generation: generation)
                return
            }
            held[pid] = nil
            lock.unlock()
            current.activation.deactivate()
        }
    }

    /// Whether the app has a menu window up: the window server lists them at
    /// the pop-up menu level.
    private static func hasOpenMenu(pid: pid_t) -> Bool {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return false
        }
        let menuLevel = Int(CGWindowLevelForKey(.popUpMenuWindow))
        return list.contains { info in
            (info[kCGWindowOwnerPID as String] as? Int) == Int(pid) && (info[kCGWindowLayer as String] as? Int) == menuLevel
        }
    }

    private static func observeRealActivation() {
        lock.lock()
        defer { lock.unlock() }
        guard !observing else { return }
        observing = true
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            lock.lock()
            held[app.processIdentifier] = nil
            lock.unlock()
        }
    }
}
