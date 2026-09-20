import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func requireFrontmost(bundleId: String?) throws {
    guard let bundleId, !bundleId.isEmpty else { return }
    let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    if front != bundleId {
        throw HelperError(
            code: "FOREGROUND_MISMATCH",
            message: "Frontmost is \(front ?? "nil"), required \(bundleId)"
        )
    }
}

enum InputDelivery: String {
    case appPost = "app_post"
    case global = "global"
}

func parseDelivery(_ raw: String?) -> InputDelivery {
    switch raw {
    case "global", "physical": return .global
    default: return .appPost
    }
}

func postEvent(_ event: CGEvent, delivery: InputDelivery, pid: pid_t?) throws {
    switch delivery {
    case .appPost:
        guard let pid else {
            throw HelperError(
                code: "INVALID",
                message: "app_post delivery requires targetPid (or resolvable bundleId)"
            )
        }
        event.postToPid(pid)
    case .global:
        event.post(tap: .cghidEventTap)
    }
}

func postClick(
    x: Double,
    y: Double,
    button: String,
    count: Int,
    delivery: InputDelivery,
    targetPid: pid_t?,
    requireFrontmostBundleId: String?
) throws {
    if !axTrusted() {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission missing")
    }
    if delivery == .global {
        try requireFrontmost(bundleId: requireFrontmostBundleId)
    }

    let mouseButton: CGMouseButton
    let downType: CGEventType
    let upType: CGEventType
    switch button {
    case "right":
        mouseButton = .right
        downType = .rightMouseDown
        upType = .rightMouseUp
    case "middle":
        mouseButton = .center
        downType = .otherMouseDown
        upType = .otherMouseUp
    default:
        mouseButton = .left
        downType = .leftMouseDown
        upType = .leftMouseUp
    }

    let point = CGPoint(x: x, y: y)
    if let move = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: .left
    ) {
        try postEvent(move, delivery: delivery, pid: targetPid)
    }
    for clickState in 1...max(1, count) {
        if let down = CGEvent(
            mouseEventSource: nil,
            mouseType: downType,
            mouseCursorPosition: point,
            mouseButton: mouseButton
        ) {
            down.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
            try postEvent(down, delivery: delivery, pid: targetPid)
        }
        if let up = CGEvent(
            mouseEventSource: nil,
            mouseType: upType,
            mouseCursorPosition: point,
            mouseButton: mouseButton
        ) {
            up.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
            try postEvent(up, delivery: delivery, pid: targetPid)
        }
    }
}

func typeText(
    _ text: String,
    delivery: InputDelivery,
    targetPid: pid_t?,
    requireFrontmostBundleId: String?
) throws {
    if !axTrusted() {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission missing")
    }
    if delivery == .global {
        try requireFrontmost(bundleId: requireFrontmostBundleId)
    }
    // No Escape ahead of the text: it is the key equivalent of Cancel, and
    // typing into a save sheet dismissed the sheet and put the text in the
    // document behind it.
    let pid = targetPid.map(keyboardTargetPid)
    for cluster in text {
        var utf16 = Array(String(cluster).utf16)
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            try postEvent(down, delivery: delivery, pid: pid)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            try postEvent(up, delivery: delivery, pid: pid)
        }
    }
}

/// The process that holds keyboard focus in `pid`'s key window.
///
/// A sandboxed app's save and open panels, share sheet and password prompts
/// are hosted by an AppKit XPC service (ViewBridge): the sheet is the app's
/// window, the controls in it live in the service, and the window server
/// hands HID key events straight to that service. A key event posted to the
/// app's own pid stops in the app — TextEdit's Save As field received nothing
/// — and AX cannot say so: the bridged elements report the app's pid. What
/// does say so is the service itself, which answers AX under its own pid and,
/// while it hosts the panel, has a focused window with a focused control.
func keyboardTargetPid(for pid: pid_t) -> pid_t {
    for host in hostedServices(of: pid) {
        let app = AXUIElementCreateApplication(host)
        if axAttributeElement(app, kAXFocusedWindowAttribute as String) != nil,
           let focused = axAttributeElement(app, kAXFocusedUIElementAttribute as String),
           axBool(focused, kAXFocusedAttribute as String) == true {
            return host
        }
    }
    return pid
}

/// The processes launchd started on `pid`'s behalf: its XPC services. The
/// app's own child processes (a browser's renderers) have the app as parent
/// and are not services.
private func hostedServices(of pid: pid_t) -> [pid_t] {
    guard let responsible = responsibleProcess else { return [] }
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var size = 0
    guard sysctl(&mib, 4, nil, &size, nil, 0) == 0, size > 0 else { return [] }
    var procs = [kinfo_proc](repeating: kinfo_proc(), count: size / MemoryLayout<kinfo_proc>.stride + 16)
    size = procs.count * MemoryLayout<kinfo_proc>.stride
    guard sysctl(&mib, 4, &procs, &size, nil, 0) == 0 else { return [] }
    return procs[0..<(size / MemoryLayout<kinfo_proc>.stride)].compactMap { info in
        let candidate = info.kp_proc.p_pid
        guard candidate != pid, info.kp_eproc.e_ppid == 1, responsible(candidate) == pid else { return nil }
        return candidate
    }
}

/// `responsibility_get_pid_responsible_for_pid`: the process on whose behalf
/// launchd runs another, which is how the system attributes an XPC service
/// to its app.
private typealias ResponsibleProcess = @convention(c) (pid_t) -> pid_t
private let responsibleProcess: ResponsibleProcess? = {
    guard let handle = dlopen("/usr/lib/system/libquarantine.dylib", RTLD_NOW),
          let symbol = dlsym(handle, "responsibility_get_pid_responsible_for_pid") else { return nil }
    return unsafeBitCast(symbol, to: ResponsibleProcess.self)
}()

/// ANSI virtual keycodes. AppKit matches a menu key equivalent by keycode, so
/// a chord has to arrive on the real one: the unicode fallback below (a
/// character on a keycode-0 event) is fine for typing and useless for `cmd+s`,
/// which then arrives as ⌘A-by-keycode carrying an "s" and nothing acts on it —
/// in the foreground too. iPhone Mirroring's Home / App Switcher / Spotlight
/// (`cmd+1..3`) found the digits; TextEdit's ⌘S found the letters. The layout
/// is ANSI-fixed so the codes are literal.
private let keyCodes: [String: CGKeyCode] = [
    "return": 0x24, "enter": 0x24, "tab": 0x30, "escape": 0x35, "esc": 0x35,
    "backspace": 0x33, "delete": 0x33, "forwarddelete": 0x75,
    "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C, "space": 0x31,
    "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
    "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
    "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "5": 0x17,
    "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19, "0": 0x1D,
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
    "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
    "t": 0x11, "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28,
    "n": 0x2D, "m": 0x2E,
    "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E, "\\": 0x2A, ";": 0x29, "'": 0x27,
    ",": 0x2B, ".": 0x2F, "/": 0x2C, "`": 0x32,
    "minus": 0x1B, "equal": 0x18, "comma": 0x2B, "period": 0x2F, "slash": 0x2C,
]

func keypress(
    _ key: String,
    delivery: InputDelivery,
    targetPid: pid_t?,
    windowId: CGWindowID?,
    requireFrontmostBundleId: String?
) throws {
    if !axTrusted() {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission missing")
    }
    if delivery == .global {
        try requireFrontmost(bundleId: requireFrontmostBundleId)
    }

    let parts = key.split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    let mainKey = parts.last ?? key
    for part in parts.dropLast() {
        switch part.lowercased() {
        case "cmd", "command", "super": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: break
        }
    }

    // A ⌘ chord is a menu command by another name, and AppKit only dispatches
    // it in the active app: posted to a background pid it is dropped without a
    // trace, whatever the transport. Plain keys reach the first responder
    // regardless. So for a chord the app is made to believe it is active for
    // the duration — see SyntheticActivation.
    if delivery == .appPost, flags.contains(.maskCommand), let targetPid {
        SyntheticActivationLease.hold(pid: targetPid, windowId: windowId)
    }
    let pid = targetPid.map(keyboardTargetPid)

    if let code = keyCodes[mainKey.lowercased()] {
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true) {
            down.flags = flags
            try postEvent(down, delivery: delivery, pid: pid)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
            up.flags = flags
            try postEvent(up, delivery: delivery, pid: pid)
        }
        return
    }

    var utf16 = Array(mainKey.utf16)
    if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
        down.flags = flags
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        try postEvent(down, delivery: delivery, pid: pid)
    }
    if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
        up.flags = flags
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        try postEvent(up, delivery: delivery, pid: pid)
    }
}

func postScroll(
    x: Double,
    y: Double,
    dx: Double,
    dy: Double,
    delivery: InputDelivery,
    targetPid: pid_t?,
    requireFrontmostBundleId: String?
) throws {
    if !axTrusted() {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission missing")
    }
    if delivery == .global {
        try requireFrontmost(bundleId: requireFrontmostBundleId)
    }

    let point = CGPoint(x: x, y: y)
    AgentOverlayController.shared.moveCursor(quartz: point, pulse: true)
    if let move = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: point,
        mouseButton: .left
    ) {
        try postEvent(move, delivery: delivery, pid: targetPid)
    }

    func ticks(_ value: Double) -> Int32 {
        if value == 0 { return 0 }
        let magnitude = max(1, Int32((abs(value) / 40.0).rounded(.up)))
        return value > 0 ? -magnitude : magnitude
    }
    var vertical = ticks(dy)
    let horizontal = ticks(dx)
    if vertical == 0 && horizontal == 0 {
        vertical = -3
    }

    let steps = max(1, max(abs(Int(vertical)), abs(Int(horizontal))))
    let verticalStep = Double(vertical) / Double(steps)
    let horizontalStep = Double(horizontal) / Double(steps)
    var verticalRemainder = 0.0
    var horizontalRemainder = 0.0
    for step in 0..<steps {
        verticalRemainder += verticalStep
        horizontalRemainder += horizontalStep
        let wheel1 = Int32(verticalRemainder.rounded())
        let wheel2 = Int32(horizontalRemainder.rounded())
        verticalRemainder -= Double(wheel1)
        horizontalRemainder -= Double(wheel2)
        if wheel1 == 0 && wheel2 == 0 { continue }
        if let scroll = CGEvent(
            scrollWheelEvent2Source: nil,
            units: .line,
            wheelCount: 2,
            wheel1: wheel1,
            wheel2: wheel2,
            wheel3: 0
        ) {
            scroll.location = point
            try postEvent(scroll, delivery: delivery, pid: targetPid)
        }
        if step % 2 == 0 {
            AgentOverlayController.shared.moveCursor(quartz: point, pulse: false)
        }
        Thread.sleep(forTimeInterval: 0.025)
    }
    AgentOverlayController.shared.moveCursor(quartz: point, pulse: true)
}

func postDrag(
    path: [CGPoint],
    delivery: InputDelivery,
    targetPid: pid_t?,
    requireFrontmostBundleId: String?
) throws {
    if !axTrusted() {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission missing")
    }
    if delivery == .global {
        try requireFrontmost(bundleId: requireFrontmostBundleId)
    }
    guard path.count >= 2 else {
        throw HelperError(code: "INVALID", message: "drag path needs at least 2 points")
    }

    let dense: [CGPoint]
    if path.count <= 3 {
        dense = AgentCursorMotion.springSamplesAlong(path)
    } else {
        dense = AgentCursorMotion.springSamples(from: path[0], to: path[path.count - 1])
    }
    let start = dense[0]
    AgentOverlayController.shared.placeCursorImmediate(quartz: start, pulse: true)
    if let move = CGEvent(
        mouseEventSource: nil,
        mouseType: .mouseMoved,
        mouseCursorPosition: start,
        mouseButton: .left
    ) {
        try postEvent(move, delivery: delivery, pid: targetPid)
    }
    Thread.sleep(forTimeInterval: 0.05)
    if let down = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: start,
        mouseButton: .left
    ) {
        try postEvent(down, delivery: delivery, pid: targetPid)
    }
    Thread.sleep(forTimeInterval: 0.04)

    let stepSleep = min(0.012, max(0.004, 1.0 / 120.0))
    for point in dense.dropFirst() {
        AgentOverlayController.shared.placeCursorImmediate(quartz: point, pulse: false)
        if let drag = CGEvent(
            mouseEventSource: nil,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: point,
            mouseButton: .left
        ) {
            try postEvent(drag, delivery: delivery, pid: targetPid)
        }
        Thread.sleep(forTimeInterval: stepSleep)
    }

    let end = dense[dense.count - 1]
    if let up = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: end,
        mouseButton: .left
    ) {
        try postEvent(up, delivery: delivery, pid: targetPid)
    }
    AgentOverlayController.shared.placeCursorImmediate(quartz: end, pulse: true)
}
