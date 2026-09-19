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
        let err = AXUIElementPerformAction(el, kAXPressAction as CFString)
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
        // Chromium contenteditables may accept AXSetValue while unfocused but
        // defer exposing/applying it until a later focus change. Focus first so
        // the write and the bounded readback belong to the same transaction.
        AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        usleep(25_000)
        let err = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value as CFTypeRef)
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
