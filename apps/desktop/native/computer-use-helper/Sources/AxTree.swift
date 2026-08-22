import ApplicationServices
import AppKit
import Foundation

// MARK: - P3 Accessibility tree + actions
//
// Walk AXUIElement for a target pid (optionally scoped to a CGWindowNumber),
// assign stable DFS indices (1…N), and perform AXPress / AXSetValue by index.
// Bounds are in global screen coordinates (top-left origin, points).

struct AxWalkLimits {
    var maxNodes: Int
    var maxDepth: Int
}

struct AxTargetHint {
    var role: String?
    var name: String?
    var value: String?
    var bounds: CGRect?
    var coordinateTransform: AxCoordinateTransform?

    var isEmpty: Bool {
        role == nil && name == nil && value == nil && bounds == nil
    }
}

struct AxCoordinateTransform {
    let originX: Double
    let originY: Double
    let sourceWidth: Double
    let sourceHeight: Double
    let coordinateWidth: Double
    let coordinateHeight: Double

    func map(_ rect: CGRect) -> CGRect {
        let sx = coordinateWidth / max(sourceWidth, 1)
        let sy = coordinateHeight / max(sourceHeight, 1)
        return CGRect(
            x: (Double(rect.minX) - originX) * sx,
            y: (Double(rect.minY) - originY) * sy,
            width: Double(rect.width) * sx,
            height: Double(rect.height) * sy
        )
    }
}

private final class AxWalkState {
    var index = 0
    var count = 0
    let limits: AxWalkLimits
    init(limits: AxWalkLimits) { self.limits = limits }
}

// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axString(_ el: AXUIElement, _ attr: String) -> String? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let v = raw else { return nil }
    if let s = v as? String { return s }
    if CFGetTypeID(v) == CFStringGetTypeID() {
        return (v as! CFString) as String
    }
    return nil
}

private func axBool(_ el: AXUIElement, _ attr: String) -> Bool? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let v = raw else { return nil }
    if let n = v as? NSNumber { return n.boolValue }
    if CFGetTypeID(v) == CFBooleanGetTypeID() {
        return CFBooleanGetValue((v as! CFBoolean))
    }
    return nil
}

// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axCGPoint(_ el: AXUIElement, _ attr: String) -> CGPoint? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let v = raw else { return nil }
    var point = CGPoint.zero
    // AXValue is not bridged as a Swift class in all SDKs — use CFType + AXValueGetValue.
    guard CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    let ax = unsafeBitCast(v, to: AXValue.self)
    guard AXValueGetValue(ax, .cgPoint, &point) else { return nil }
    return point
}

// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axCGSize(_ el: AXUIElement, _ attr: String) -> CGSize? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let v = raw else { return nil }
    var size = CGSize.zero
    guard CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
    let ax = unsafeBitCast(v, to: AXValue.self)
    guard AXValueGetValue(ax, .cgSize, &size) else { return nil }
    return size
}

// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &raw) == .success,
          let arr = raw as? [AXUIElement] else { return [] }
    return arr
}

private func axActions(_ el: AXUIElement) -> [String] {
    var raw: CFArray?
    guard AXUIElementCopyActionNames(el, &raw) == .success,
          let arr = raw as? [String] else { return [] }
    return arr
}

// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axRole(_ el: AXUIElement) -> String {
    axString(el, kAXRoleAttribute as String) ?? "unknown"
}

private func mainDisplaySizePoints() -> (width: Double, height: Double) {
    let frame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
    return (Double(frame.width), Double(frame.height))
}

/// Convert AX frame (top-left global points) into our capture coordinate space
/// which is top-left of the primary display, optionally downscaled to maxWidth.
func mapAxBoundsToCapture(
    x: Double, y: Double, w: Double, h: Double,
    transform: AxCoordinateTransform
) -> [String: Double] {
    let mapped = transform.map(CGRect(x: x, y: y, width: w, height: h))
    return [
        "x": Double(mapped.minX),
        "y": Double(mapped.minY),
        "width": Double(mapped.width),
        "height": Double(mapped.height),
    ]
}

private func nodeDict(
    el: AXUIElement,
    state: AxWalkState,
    depth: Int,
    coordinateTransform: AxCoordinateTransform
) -> [String: Any]? {
    if state.count >= state.limits.maxNodes { return nil }
    if depth > state.limits.maxDepth { return nil }

    state.index += 1
    state.count += 1
    let idx = state.index

    let role = axRole(el)
    let name = axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)
        ?? axString(el, "AXLabel")
    let value: String? = {
        if let s = axString(el, kAXValueAttribute as String) { return s }
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &raw) == .success,
              let v = raw else { return nil }
        if let n = v as? NSNumber { return n.stringValue }
        return String(describing: v)
    }()

    let pos = axCGPoint(el, kAXPositionAttribute as String)
    let size = axCGSize(el, kAXSizeAttribute as String)
    var bounds: [String: Double]?
    if let pos, let size {
        bounds = mapAxBoundsToCapture(
            x: Double(pos.x), y: Double(pos.y),
            w: Double(size.width), h: Double(size.height),
            transform: coordinateTransform
        )
    }

    let actions = axActions(el)
    let settable: Bool = {
        var settable: DarwinBoolean = false
        // AXUIElementIsAttributeSettable is the right API for value writability.
        let err = AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
        return err == .success && settable.boolValue
    }()

    var kids: [[String: Any]] = []
    if depth < state.limits.maxDepth {
        for child in axChildren(el) {
            if state.count >= state.limits.maxNodes { break }
            if let d = nodeDict(
                el: child, state: state, depth: depth + 1,
                coordinateTransform: coordinateTransform
            ) {
                kids.append(d)
            }
        }
    }

    var dict: [String: Any] = [
        "index": idx,
        "role": role,
        "actions": actions,
        "enabled": axBool(el, kAXEnabledAttribute as String) ?? true,
        "focused": axBool(el, kAXFocusedAttribute as String) ?? false,
        "settable": settable,
    ]
    if let name, !name.isEmpty { dict["name"] = name }
    if let value, !value.isEmpty {
        // Cap value length to keep wire JSON small.
        dict["value"] = value.count > 500 ? String(value.prefix(500)) : value
    }
    if let bounds { dict["bounds"] = bounds }
    if !kids.isEmpty { dict["children"] = kids }
    return dict
}

private func focusedOrFirstWindow(app: AXUIElement) -> AXUIElement? {
    var raw: CFTypeRef?
    if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &raw) == .success,
       let win = raw {
        return (win as! AXUIElement)
    }
    raw = nil
    if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
       let wins = raw as? [AXUIElement], let first = wins.first {
        return first
    }
    return nil
}

struct AxWindowMetadata {
    let element: AXUIElement
    let role: String
    let subrole: String?
    let modal: Bool
    let focused: Bool
}

struct AxTransientRoot {
    let id: String
    let metadata: AxWindowMetadata
    let bounds: CGRect
    let title: String
}

private final class AxRootRegistry: @unchecked Sendable {
    static let shared = AxRootRegistry()

    private struct Entry {
        let pid: pid_t
        let element: AXUIElement
    }

    private let lock = NSLock()
    private var sequence = 0
    private var entries: [String: Entry] = [:]

    func sync(pid: pid_t, elements: [AXUIElement]) -> [(id: String, element: AXUIElement)] {
        lock.lock()
        defer { lock.unlock() }

        let previous = entries.filter { $0.value.pid == pid }
        var nextForPid: [String: Entry] = [:]
        var result: [(id: String, element: AXUIElement)] = []
        var used = Set<String>()
        for element in elements {
            let existing = previous.first { id, entry in
                !used.contains(id) && CFEqual(entry.element, element)
            }
            let id: String
            if let existing {
                id = existing.key
            } else {
                sequence += 1
                id = "axr:\(sequence)"
            }
            used.insert(id)
            let entry = Entry(pid: pid, element: element)
            nextForPid[id] = entry
            result.append((id: id, element: element))
        }

        entries = entries.filter { $0.value.pid != pid }
        for (id, entry) in nextForPid { entries[id] = entry }
        return result
    }

    func resolve(id: String, pid: pid_t) throws -> AXUIElement {
        lock.lock()
        let entry = entries[id]
        lock.unlock()
        guard let entry, entry.pid == pid else {
            throw HelperError(code: "AX_ROOT_NOT_FOUND", message: "AX root \(id) is no longer available")
        }
        var role: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            entry.element,
            kAXRoleAttribute as CFString,
            &role
        ) == .success else {
            throw HelperError(code: "AX_ROOT_NOT_FOUND", message: "AX root \(id) is stale")
        }
        return entry.element
    }
}

func classifyAxWindow(_ metadata: AxWindowMetadata) -> (kind: String, modal: Bool) {
    let role = metadata.role.lowercased()
    let subrole = metadata.subrole?.lowercased() ?? ""
    let kind: String
    if role.contains("sheet") || subrole.contains("sheet") {
        kind = "sheet"
    } else if role.contains("dialog") || subrole.contains("dialog") {
        kind = "dialog"
    } else if role == "axmenu" || subrole == "axmenu" {
        kind = "menu"
    } else if role.contains("popover") || subrole.contains("popover") {
        kind = "popover"
    } else {
        kind = "window"
    }
    return (kind: kind, modal: metadata.modal || kind == "sheet" || kind == "menu")
}

private func axWindows(app: AXUIElement) -> [AXUIElement] {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &raw) == .success,
          let windows = raw as? [AXUIElement] else { return [] }
    return windows
}

func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = axCGPoint(element, kAXPositionAttribute as String),
          let size = axCGSize(element, kAXSizeAttribute as String) else { return nil }
    return CGRect(origin: position, size: size)
}

func axFramesMatch(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    let positionDelta = max(abs(lhs.minX - rhs.minX), abs(lhs.minY - rhs.minY))
    let sizeDelta = max(abs(lhs.width - rhs.width), abs(lhs.height - rhs.height))
    return positionDelta <= 12 && sizeDelta <= 12
}

private func titleMatches(_ element: AXUIElement, _ expected: String) -> Bool {
    let actual = axString(element, kAXTitleAttribute as String) ?? ""
    guard !actual.isEmpty else { return false }
    return actual.caseInsensitiveCompare(expected) == .orderedSame
        || actual.localizedCaseInsensitiveContains(expected)
        || expected.localizedCaseInsensitiveContains(actual)
}

private func windowMetadata(_ element: AXUIElement) -> AxWindowMetadata {
    AxWindowMetadata(
        element: element,
        role: axRole(element),
        subrole: axString(element, kAXSubroleAttribute as String),
        modal: axBool(element, kAXModalAttribute as String) ?? false,
        focused: axBool(element, kAXFocusedAttribute as String) ?? false
    )
}

private func axAttributeElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
          let raw else { return nil }
    return (raw as! AXUIElement)
}

private func axRootTitle(_ element: AXUIElement, metadata: AxWindowMetadata) -> String {
    let candidates = [
        axString(element, kAXTitleAttribute as String),
        axString(element, kAXDescriptionAttribute as String),
        axString(element, kAXValueAttribute as String),
        metadata.subrole,
        metadata.role,
    ]
    return candidates.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .first(where: { !$0.isEmpty }) ?? metadata.role
}

func discoverAxTransientRoots(
    pid: pid_t,
    includeDescendants: Bool
) -> [AxTransientRoot] {
    guard axTrusted() else { return [] }
    let app = AXUIElementCreateApplication(pid)
    var elements: [AXUIElement] = []

    func appendCandidate(_ element: AXUIElement) {
        if elements.contains(where: { CFEqual($0, element) }) { return }
        let metadata = windowMetadata(element)
        guard classifyAxWindow(metadata).kind != "window",
              axBool(element, "AXVisible") != false,
              let frame = axFrame(element),
              frame.width > 1, frame.height > 1 else { return }
        elements.append(element)
    }

    for window in axWindows(app: app) { appendCandidate(window) }

    if includeDescendants {
        var visited = 0
        func walk(_ element: AXUIElement, depth: Int) {
            guard depth <= 8, visited < 800 else { return }
            visited += 1
            appendCandidate(element)
            for child in axChildren(element) { walk(child, depth: depth + 1) }
        }
        if let menuBar = axAttributeElement(app, kAXMenuBarAttribute as String) {
            walk(menuBar, depth: 0)
        }
        for window in axWindows(app: app) { walk(window, depth: 0) }
    }

    let registered = AxRootRegistry.shared.sync(pid: pid, elements: elements)
    return registered.compactMap { registered in
        let metadata = windowMetadata(registered.element)
        guard let bounds = axFrame(registered.element) else { return nil }
        return AxTransientRoot(
            id: registered.id,
            metadata: metadata,
            bounds: bounds,
            title: axRootTitle(registered.element, metadata: metadata)
        )
    }
}

func resolveRegisteredAxRoot(id: String, pid: pid_t) throws -> AXUIElement {
    try AxRootRegistry.shared.resolve(id: id, pid: pid)
}

func liveAxRootGeometry(id: String, pid: pid_t) throws -> LiveWindowGeometry {
    let element = try resolveRegisteredAxRoot(id: id, pid: pid)
    guard let bounds = axFrame(element), bounds.width > 1, bounds.height > 1 else {
        throw HelperError(code: "AX_ROOT_NOT_FOUND", message: "AX root \(id) has no visible bounds")
    }
    let bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    return LiveWindowGeometry(
        bounds: bounds,
        pid: Int(pid),
        bundleId: bundleId,
        backingScale: activeDisplay(for: bounds)?.scale ?? 1
    )
}

/// Bind a CGWindowNumber to one AXWindow. The PID and live CG bounds are both
/// checked so same-title windows cannot be observed or acted on by mistake.
func resolveAxWindow(
    pid: pid_t,
    windowId: Int,
    windowTitle: String? = nil
) throws -> AxWindowMetadata {
    let geometry = try liveWindowGeometry(windowId: windowId)
    guard geometry.pid == Int(pid) else {
        throw HelperError(
            code: "AX_WINDOW_NOT_FOUND",
            message: "Window \(windowId) does not belong to pid \(pid)"
        )
    }

    let windows = axWindows(app: AXUIElementCreateApplication(pid))
    let boundsMatches = windows.filter {
        guard let frame = axFrame($0) else { return false }
        return axFramesMatch(frame, geometry.bounds)
    }
    if boundsMatches.count == 1 {
        return windowMetadata(boundsMatches[0])
    }

    if boundsMatches.count > 1, let title = windowTitle, !title.isEmpty {
        let titleCandidates = boundsMatches.filter { titleMatches($0, title) }
        if titleCandidates.count == 1 {
            return windowMetadata(titleCandidates[0])
        }
    }

    if boundsMatches.isEmpty {
        throw HelperError(
            code: "AX_WINDOW_NOT_FOUND",
            message: "No AXWindow matches CG window \(windowId) for pid \(pid)"
        )
    }
    throw HelperError(
        code: "AX_WINDOW_AMBIGUOUS",
        message: "Multiple AXWindows match CG window \(windowId) for pid \(pid)"
    )
}

private func resolveAxRoot(
    app: AXUIElement,
    pid: pid_t,
    axRootId: String?,
    windowId: Int?,
    windowTitle: String?
) throws -> AXUIElement {
    if let axRootId {
        return try resolveRegisteredAxRoot(id: axRootId, pid: pid)
    }
    if let windowId {
        return try resolveAxWindow(
            pid: pid,
            windowId: windowId,
            windowTitle: windowTitle
        ).element
    }
    if let title = windowTitle, !title.isEmpty {
        let matches = axWindows(app: app).filter { titleMatches($0, title) }
        if matches.count == 1 { return matches[0] }
        if matches.count > 1 {
            throw HelperError(
                code: "AX_WINDOW_AMBIGUOUS",
                message: "Multiple AXWindows match title \(title) for pid \(pid)"
            )
        }
    }
    return focusedOrFirstWindow(app: app) ?? app
}

/// Snapshot AX tree for a process, scoped to a validated native window when available.
func axTreeSnapshot(
    pid: pid_t,
    maxNodes: Int = 400,
    maxDepth: Int = 24,
    captureWidth: Double? = nil,
    captureHeight: Double? = nil,
    captureX: Double? = nil,
    captureY: Double? = nil,
    captureSourceWidth: Double? = nil,
    captureSourceHeight: Double? = nil,
    windowTitle: String? = nil,
    axRootId: String? = nil,
    windowId: Int? = nil
) throws -> [String: Any] {
    guard axTrusted() else {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission not granted for Computer Use helper")
    }
    let app = AXUIElementCreateApplication(pid)
    let rootEl = try resolveAxRoot(
        app: app,
        pid: pid,
        axRootId: axRootId,
        windowId: windowId,
        windowTitle: windowTitle
    )

    let state = AxWalkState(limits: AxWalkLimits(maxNodes: max(1, maxNodes), maxDepth: max(1, maxDepth)))
    let display = mainDisplaySizePoints()
    let coordinateTransform = AxCoordinateTransform(
        originX: captureX ?? 0,
        originY: captureY ?? 0,
        sourceWidth: captureSourceWidth ?? display.width,
        sourceHeight: captureSourceHeight ?? display.height,
        coordinateWidth: captureWidth ?? display.width,
        coordinateHeight: captureHeight ?? display.height
    )
    guard let tree = nodeDict(
        el: rootEl, state: state, depth: 0,
        coordinateTransform: coordinateTransform
    ) else {
        throw HelperError(code: "AX_EMPTY", message: "No accessibility nodes for pid \(pid)")
    }
    return [
        "tree": tree,
        "nodeCount": state.count,
        "maxNodes": maxNodes,
        "maxDepth": maxDepth,
        "display": ["width": display.width, "height": display.height],
        "pid": Int(pid),
    ]
}

/// Re-walk tree to find the Nth DFS node (1-based index matching snapshot).
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
    axString(el, kAXValueAttribute as String)
        ?? axString(el, kAXTitleAttribute as String)
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
    targetHint: AxTargetHint? = nil
) throws -> [String: Any] {
    guard axTrusted() else {
        throw HelperError(code: "AX_MISSING", message: "Accessibility permission not granted for Computer Use helper")
    }
    guard index >= 1 else {
        throw HelperError(code: "INVALID", message: "index must be >= 1")
    }
    let app = AXUIElementCreateApplication(pid)
    let rootEl = try resolveAxRoot(
        app: app,
        pid: pid,
        axRootId: axRootId,
        windowId: windowId,
        windowTitle: windowTitle
    )

    let resolved = try resolveTarget(root: rootEl, requestedIndex: index, hint: targetHint)
    let el = resolved.element

    let beforeValue = axString(el, kAXValueAttribute as String)
        ?? axString(el, kAXTitleAttribute as String)
    let beforeName = axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)

    let act = action.lowercased()
    switch act {
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
    if let afterValue { result["afterValue"] = afterValue }
    if let beforeName { result["beforeName"] = beforeName }
    if let afterName { result["afterName"] = afterName }
    if let value { result["value"] = value }
    return result
}
