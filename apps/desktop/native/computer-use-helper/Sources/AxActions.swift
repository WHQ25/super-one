import AppKit
import ApplicationServices
import Foundation

// Resolve observed targets and dispatch semantic actions.

private func findByIndex(root: AXUIElement, target: Int) -> AXUIElement? {
    var current = 0
    func walk(_ el: AXUIElement) -> AXUIElement? {
        current += 1
        if current == target { return el }
        for child in axChildren(el) {
            if let hit = walk(child) { return hit }
        }
        return nil
    }
    return walk(root)
}

private struct AxResolvedTarget {
    let element: AXUIElement
    let index: Int
    let recovered: Bool
}

private func normalizedAxRole(_ role: String) -> String {
    let raw = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
    return raw.lowercased()
}

private func axElementName(_ el: AXUIElement) -> String? {
    axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)
        ?? axString(el, "AXLabel")
}

private func axElementValue(_ el: AXUIElement) -> String? {
    // Deliberately no title fallback: the title is already reported separately
    // as `name`, and letting it stand in for a missing value made every
    // valueless control look like "value unchanged" instead of "no value".
    axValueString(el)
}

private func axElementBounds(_ el: AXUIElement, hint: AxTargetHint) -> CGRect? {
    guard let pos = axCGPoint(el, kAXPositionAttribute as String),
          let size = axCGSize(el, kAXSizeAttribute as String) else { return nil }
    guard let transform = hint.coordinateTransform else {
        return CGRect(x: pos.x, y: pos.y, width: size.width, height: size.height)
    }
    return transform.map(CGRect(x: pos.x, y: pos.y, width: size.width, height: size.height))
}

private func targetScore(
    _ el: AXUIElement,
    hint: AxTargetHint,
    requireBoundsMatch: Bool
) -> Double? {
    if let expectedRole = hint.role,
       normalizedAxRole(axRole(el)) != normalizedAxRole(expectedRole) {
        return nil
    }

    var score = hint.role == nil ? 0.0 : 100.0
    if let expectedName = hint.name, !expectedName.isEmpty {
        guard axElementName(el) == expectedName else { return nil }
        score += 50
    }

    if let expectedBounds = hint.bounds {
        guard let actual = axElementBounds(el, hint: hint) else { return nil }
        let centerDistance = hypot(actual.midX - expectedBounds.midX, actual.midY - expectedBounds.midY)
        let sizeDelta = abs(actual.width - expectedBounds.width) + abs(actual.height - expectedBounds.height)
        let positionTolerance = max(12, min(max(expectedBounds.width, expectedBounds.height) * 0.15, 48))
        let sizeTolerance = max(12, (expectedBounds.width + expectedBounds.height) * 0.2)
        let boundsMatch = centerDistance <= positionTolerance && sizeDelta <= sizeTolerance
        if requireBoundsMatch && !boundsMatch { return nil }
        if boundsMatch {
            score += max(0, 100 - centerDistance - sizeDelta * 0.25)
        }
    }

    if let expectedValue = hint.value, axElementValue(el) == expectedValue {
        score += 10
    }
    return score
}

private func resolveTarget(root: AXUIElement, requestedIndex: Int, hint: AxTargetHint?) throws -> AxResolvedTarget {
    guard let hint else {
        guard let element = findByIndex(root: root, target: requestedIndex) else {
            throw HelperError(code: "AX_NOT_FOUND", message: "No AX node at index \(requestedIndex)")
        }
        return AxResolvedTarget(element: element, index: requestedIndex, recovered: false)
    }

    if let indexed = findByIndex(root: root, target: requestedIndex),
       targetScore(indexed, hint: hint, requireBoundsMatch: true) != nil {
        return AxResolvedTarget(element: indexed, index: requestedIndex, recovered: false)
    }

    var current = 0
    var candidates: [(element: AXUIElement, index: Int, score: Double)] = []
    func walk(_ element: AXUIElement) {
        current += 1
        let index = current
        // Window managers may move an inactive app between observe and act.
        // During recovery, bounds rank candidates but uniqueness is decisive.
        if let score = targetScore(element, hint: hint, requireBoundsMatch: false) {
            candidates.append((element, index, score))
        }
        for child in axChildren(element) { walk(child) }
    }
    walk(root)
    candidates.sort { $0.score > $1.score }

    guard let best = candidates.first else {
        throw HelperError(code: "AX_STALE_REF", message: "AX ref no longer matches a live element")
    }
    if candidates.count > 1, abs(best.score - candidates[1].score) < 0.5 {
        throw HelperError(code: "AX_STALE_REF", message: "AX ref matches multiple live elements")
    }
    return AxResolvedTarget(element: best.element, index: best.index, recovered: true)
}

/// A leaf menu command, as opposed to a menu bar item or a submenu parent
/// whose press only opens a menu.
private func axIsMenuCommand(_ el: AXUIElement) -> Bool {
    axRole(el) == "AXMenuItem" && !axChildren(el).contains { axRole($0) == "AXMenu" }
}

/// How long AppKit gets to re-validate the app's menus after activation before
/// the command is pressed anyway (a command that is disabled in the foreground
/// too is simply disabled). Measured on Finder: the flag turns on 0.25–1.0s
/// after activate.
private let axMenuValidationTimeout: TimeInterval = 1.5
/// A flag that already read true before activation is the last validation's
/// result, left from before the app went to the background; nothing observable
/// distinguishes it from a fresh one, so it only counts after the longest
/// validation delay seen has passed.
private let axMenuStaleFlagSettle: TimeInterval = 1.1

/// Press a menu command in an app that may be in the background.
///
/// AppKit validates menu items against the active app's key window, so a
/// background app's commands are disabled and AXPress on one reports success
/// while doing nothing — Finder's View ▸ Sort By ▸ Date Modified left the sort
/// column alone, and so did its key equivalent posted to the pid, System Events,
/// an AX-focused window, and a press after AX reads had refreshed the flag.
/// There is no background route through the window server. What there is: make
/// the app *believe* it is active (`SyntheticActivation`), wait for AppKit to
/// re-validate, press, and tell it it is not. Nothing on screen changes. Only
/// when that fails does the app get activated for real, for the time the
/// validation takes, and the previous app handed straight back — one blink.
/// Pressing before validation does nothing even with the app active, so the
/// wait is for the flag, not for activation. Pressing the command in the closed
/// menu tree means no menu opens on screen and the whole path is one press.
private func axPressMenuCommand(_ el: AXUIElement, pid: pid_t, believesActive: Bool) -> AXError {
    let previous = NSWorkspace.shared.frontmostApplication
    guard previous?.processIdentifier != pid, let target = NSRunningApplication(processIdentifier: pid) else {
        return AXUIElementPerformAction(el, kAXPressAction as CFString)
    }
    // The item's own AXEnabled is not refreshed on read; enumerating the
    // menus above it, as a tree read does, is what refreshes it.
    var ancestors: [AXUIElement] = []
    var cursor: AXUIElement? = axAttributeElement(el, kAXParentAttribute as String)
    while let node = cursor, ancestors.count < 12 {
        ancestors.insert(node, at: 0)
        if axRole(node) == "AXMenuBar" { break }
        cursor = axAttributeElement(node, kAXParentAttribute as String)
    }
    let wasEnabled = axBool(el, kAXEnabledAttribute as String) == true
    // A real activation is asynchronous: the app may not have processed it yet
    // when the flag is read, so a flag that was already true is only trusted
    // after the stale settle. A synthetic one has been processed by the time
    // the app reports a focused window, so its first refreshed read is fresh.
    let waitForValidation = { (flagIsFresh: Bool) in
        let activated = Date()
        let deadline = activated.addingTimeInterval(axMenuValidationTimeout)
        while Date() < deadline {
            for node in ancestors { _ = axChildren(node) }
            if axBool(el, kAXEnabledAttribute as String) == true,
               flagIsFresh || !wasEnabled || Date().timeIntervalSince(activated) >= axMenuStaleFlagSettle { break }
            // AppKit validates menus when its main thread is idle; polling it
            // every 10ms kept it busy answering AX instead (0.8s to validate
            // what took 0ms with the reads spaced out).
            usleep(60_000)
        }
    }
    let err: AXError
    if believesActive {
        waitForValidation(true)
        err = AXUIElementPerformAction(el, kAXPressAction as CFString)
    } else {
        target.activate()
        waitForValidation(false)
        err = AXUIElementPerformAction(el, kAXPressAction as CFString)
    }
    // Whichever way it was pressed, the command may have activated the app for
    // real (a save panel does); the user's app comes back either way.
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
       let previous, previous.processIdentifier != pid, !previous.isTerminated {
        previous.activate()
    }
    return err
}

func axPerform(
    pid: pid_t,
    index: Int,
    action: String,
    value: String? = nil,
    windowTitle: String? = nil,
    axRootId: String? = nil,
    windowId: Int? = nil,
    source: String? = nil,
    targetHint: AxTargetHint? = nil
) throws -> [String: Any] {
    guard axTrusted() else {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission not granted for Computer Use helper")
    }
    guard index >= 1 else {
        throw HelperError(code: "INVALID", message: "index must be >= 1")
    }
    let app = axApplication(pid)
    if let source, source != "menuBar" {
        throw HelperError(code: "INVALID", message: "Unknown AX source")
    }
    let rootEl: AXUIElement
    // The app believes it is active from before the walk that resolves the
    // target, so the walk validates the menu in the state the press needs —
    // see SyntheticActivationLease for why the two must agree.
    let menuActivation = source == "menuBar" && ["press", "axpress"].contains(action.lowercased())
        && SyntheticActivationLease.hold(pid: pid, windowId: nil)
    if source == "menuBar" {
        guard let menu = axMenuBar(app) else {
            throw HelperError(code: "AX_STALE_REF", message: "The app menu bar is no longer available")
        }
        rootEl = menu
    } else {
        rootEl = try resolveAxRoot(
            app: app,
            pid: pid,
            axRootId: axRootId,
            windowId: windowId,
            windowTitle: windowTitle
        )
    }

    let resolved = try resolveTarget(root: rootEl, requestedIndex: index, hint: targetHint)
    let el = resolved.element
    // Closed menu commands remain actionable through AXPress. Identity hints
    // above still reject a changed command; visibility is not a prerequisite.

    let beforeValue = axElementValue(el)
    let beforeSelected = axItemSelected(el)
    let beforeName = axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)

    let act = action.lowercased()
    switch act {
    case "select":
        try axSelectItem(el)
    case "open":
        try axOpenItem(el)
    case "press", "axpress":
        let err = source == "menuBar" && axIsMenuCommand(el)
            ? axPressMenuCommand(el, pid: pid, believesActive: menuActivation)
            : AXUIElementPerformAction(el, kAXPressAction as CFString)
        if err != .success {
            throw HelperError(code: "AX_ACTION", message: "AXPress failed (\(err.rawValue))")
        }
    case "focus", "axraise":
        // Best-effort focus.
        AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        let err = AXUIElementPerformAction(el, kAXRaiseAction as CFString)
        if err != .success {
            // Focus attribute alone is often enough; ignore raise failures.
        }
    case "set_value", "setvalue", "axsetvalue":
        guard let value else {
            throw HelperError(code: "INVALID", message: "value required for set_value")
        }
        var settable: DarwinBoolean = false
        let check = AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
        if check != .success || !settable.boolValue {
            throw HelperError(code: "AX_NOT_SETTABLE", message: "AXValue is not settable on this element")
        }
        // A scroller's AXValue is a number (0…1), and setting it is the one way
        // to scroll an app in the background: wheel events posted to a pid are
        // dropped by an inactive app, raised window or not. Written in the
        // element's own type; a string on a numeric value fails.
        var currentRaw: CFTypeRef?
        AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &currentRaw)
        let numeric = currentRaw is NSNumber
        let payload: CFTypeRef = numeric ? (NSNumber(value: Double(value) ?? 0) as CFTypeRef) : (value as CFTypeRef)
        // Chromium contenteditables may accept AXSetValue while unfocused but
        // defer exposing/applying it until a later focus change. Focus first so
        // the write and the bounded readback belong to the same transaction.
        // A scroller is never focused.
        if !numeric {
            AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            usleep(25_000)
        }
        let err = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, payload)
        if err != .success {
            throw HelperError(code: "AX_ACTION", message: "AXSetValue failed (\(err.rawValue))")
        }
    default:
        throw HelperError(code: "INVALID", message: "Unknown ax action: \(action)")
    }

    // Electron/contenteditable controls can acknowledge AXSetValue before their
    // exposed AXValue changes. Poll briefly so a real async write is not reported
    // as a confirmed no-op.
    var afterValue: String?
    let settleDeadline = Date().addingTimeInterval(act == "set_value" || act == "setvalue" || act == "axsetvalue" ? 0.75 : 0.05)
    repeat {
        usleep(25_000)
        afterValue = axElementValue(el)
        if let value, let afterValue, afterValue == value || afterValue.contains(value) {
            break
        }
    } while Date() < settleDeadline

    let afterName = axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)

    var result: [String: Any] = [
        "ok": true,
        "requestedIndex": index,
        "index": resolved.index,
        "recovered": resolved.recovered,
        "action": action,
        "role": axRole(el),
    ]
    if let beforeValue { result["beforeValue"] = beforeValue }
    if let beforeSelected { result["beforeSelected"] = beforeSelected }
    if let selected = axItemSelected(el) { result["afterSelected"] = selected }
    if let afterValue { result["afterValue"] = afterValue }
    if let beforeName { result["beforeName"] = beforeName }
    if let afterName { result["afterName"] = afterName }
    if let value { result["value"] = value }
    return result
}
