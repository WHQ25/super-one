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

    if let escape = CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: true) {
        try postEvent(escape, delivery: delivery, pid: targetPid)
        if let escapeUp = CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: false) {
            try postEvent(escapeUp, delivery: delivery, pid: targetPid)
        }
    }
    Thread.sleep(forTimeInterval: 0.05)

    for cluster in text {
        var utf16 = Array(String(cluster).utf16)
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            try postEvent(down, delivery: delivery, pid: targetPid)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            try postEvent(up, delivery: delivery, pid: targetPid)
        }
    }
}

func keypress(
    _ key: String,
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

    let keyCodes: [String: CGKeyCode] = [
        "return": 0x24,
        "enter": 0x24,
        "tab": 0x30,
        "escape": 0x35,
        "esc": 0x35,
        "backspace": 0x33,
        "delete": 0x33,
        "up": 0x7E,
        "down": 0x7D,
        "left": 0x7B,
        "right": 0x7C,
        "space": 0x31,
    ]

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

    if let code = keyCodes[mainKey.lowercased()] {
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true) {
            down.flags = flags
            try postEvent(down, delivery: delivery, pid: targetPid)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
            up.flags = flags
            try postEvent(up, delivery: delivery, pid: targetPid)
        }
        return
    }

    var utf16 = Array(mainKey.utf16)
    if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
        down.flags = flags
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        try postEvent(down, delivery: delivery, pid: targetPid)
    }
    if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
        up.flags = flags
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        try postEvent(up, delivery: delivery, pid: targetPid)
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
