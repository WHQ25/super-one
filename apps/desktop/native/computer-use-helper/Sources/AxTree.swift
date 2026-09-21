import ApplicationServices
import AppKit
import Foundation

// MARK: - P3 Accessibility tree + actions
//
// Walk AXUIElement for a target pid (optionally scoped to a CGWindowNumber),
// assign stable DFS indices (1…N), and perform AXPress / AXSetValue by index.
// Bounds are in global screen coordinates (top-left origin, points).

// MARK: - AX messaging budget
//
// Every AX read is a synchronous mach message to the target app. An app that has
// stopped servicing its runloop — quitting, hung, SIGSTOPped — answers none of
// them, and with no explicit timeout each call blocks for seconds. Measured on a
// frozen app: one `list_windows` went 0.4s → 4.6s, two went 1.1s → 12.1s. That is
// how "the user closed the app we were driving" turns into an RPC timeout, and no
// liveness check can prevent it: a quitting app is still in `runningApplications`
// with a live pid, it just stops answering.

/// Ceiling for a single AX message, applied process-wide.
let axDefaultMessagingTimeout: Float = 2

/// Discovery walks *every* running app, so one of them quitting must not cost
/// seconds. Missing a root beats stalling the scan — the next scan picks it up.
let axDiscoveryMessagingTimeout: Float = 0.3

/// Bound every AX message this process sends. A per-element timeout overrides this
/// for that element only; elements obtained *from* it fall back to this value.
func installAxMessagingDefaults() {
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), axDefaultMessagingTimeout)
}

/// App-level AX element carrying an explicit per-message timeout.
func axApplication(_ pid: pid_t, timeout: Float = axDefaultMessagingTimeout) -> AXUIElement {
    let element = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(element, timeout)
    return element
}

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
    /// Set when a node budget or the depth limit stopped the walk short. The
    /// caller cannot infer this: a depth-pruned tree can finish well under
    /// maxNodes, and a tree that happens to fill the budget exactly is complete.
    var truncated = false
    /// AppKit validates menu items against the active app's key window, so a
    /// background app's menu `AXEnabled` flags describe no key window at all:
    /// Finder's View menu reads 3 of 41 commands enabled until Finder is
    /// active. The walk makes the app believe it is active first (see
    /// SyntheticActivationLease); when that is not possible, a walk with this
    /// set reports every menu node enabled instead of reporting those flags
    /// as if they were the commands' own state.
    var unvalidatedMenuFlags = false
    /// Menu bar walk: each top-level menu gets an equal share of what is left
    /// of the budget, so a bulky early menu (Services, Open Recent, Open With)
    /// cannot starve the later ones — Preview's Tools ▸ Crop was never read.
    /// A menu cut short is counted through, so the indexes after it still
    /// match the DFS `ax_action` resolves by.
    var menuShare = false
    var softCap = Int.max
    let limits: AxWalkLimits
    init(limits: AxWalkLimits) { self.limits = limits }
    var cap: Int { min(limits.maxNodes, softCap) }
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

func axBool(_ el: AXUIElement, _ attr: String) -> Bool? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let v = raw else { return nil }
    if let n = v as? NSNumber { return n.boolValue }
    if CFGetTypeID(v) == CFBooleanGetTypeID() {
        return CFBooleanGetValue((v as! CFBoolean))
    }
    return nil
}

func axInt(_ el: AXUIElement, _ attr: String) -> Int? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &raw) == .success,
          let n = raw as? NSNumber else { return nil }
    return n.intValue
}

func axMenuBar(_ app: AXUIElement) -> AXUIElement? {
    axAttributeElement(app, kAXMenuBarAttribute as String)
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

/// Below this many children a container is walked whole; above it, a table's
/// off-screen rows are dropped (one extra attribute read per such container).
private let axVisibleRowsThreshold = 30

/// The children every walk agrees on — snapshot, action resolution and subtree
/// accounting all number nodes by this order, so it is the one place to decide
/// what a walk sees.
///
/// A table or outline exposes every row it holds, on screen or not:
/// /System/Library's 163 rows took 12s to read and overran the 1500-node
/// budget before the row the run was scrolling towards, and no scroll could
/// change which rows the walk started with. What the table shows is the
/// observation; the rest come into view by scrolling, which is what a run does.
///
/// Not private: `Mirror.swift` reads the same attributes off the mirroring window.
func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &raw) == .success,
          let arr = raw as? [AXUIElement] else { return [] }
    guard arr.count > axVisibleRowsThreshold,
          AXUIElementCopyAttributeValue(el, "AXVisibleRows" as CFString, &raw) == .success,
          let visible = raw as? [AXUIElement] else { return arr }
    return arr.filter { child in axRole(child) != "AXRow" || visible.contains { CFEqual($0, child) } }
}

/// Read AXValue as text.
///
/// Not just `axString`: AXValue is a CFNumber on every toggle-shaped control
/// (radio, checkbox, tab, slider), and a String-only read returns nil there.
/// The snapshot walk and the post-action readback must agree on this, or an
/// action's "did it work?" check compares two different notions of value.
func axValueString(_ el: AXUIElement) -> String? {
    if let s = axString(el, kAXValueAttribute as String) { return s }
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &raw) == .success,
          let v = raw else { return nil }
    if let n = v as? NSNumber { return n.stringValue }
    // An element's value can be another element (a table's AXValue is its
    // selected row's); its description is an address that changes with every
    // read and showed up in every act diff as a value change.
    let type = CFGetTypeID(v)
    if type == AXUIElementGetTypeID() || type == CFArrayGetTypeID() { return nil }
    return String(describing: v)
}

func axActions(_ el: AXUIElement) -> [String] {
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

/// Roles Chromium and AppKit emit purely as layout scaffolding.
private let axGenericWrapperRoles: Set<String> = ["AXGroup", "AXUnknown"]

/// Actions Chromium hangs off nearly every node; they carry no interaction signal.
private let axAmbientActions: Set<String> = [
    "AXShowMenu",
    "AXScrollToVisible",
    "AXShowDefaultUI",
    "AXShowAlternateUI",
]

/// A wrapper carries no information of its own: no label, no value, nothing to
/// act on. Dropping it and hoisting its children is what keeps a web-heavy tree
/// inside the node budget — Electron nests 6–8 anonymous `AXGroup`s above the
/// `AXWebArea` alone.
func axNodeIsElidableWrapper(
    role: String,
    name: String?,
    value: String?,
    actions: [String],
    settable: Bool,
    childCount: Int,
    insideWebArea: Bool
) -> Bool {
    guard axGenericWrapperRoles.contains(role) else { return false }
    if let name, !name.isEmpty { return false }
    if let value, !value.isEmpty { return false }
    if actions.contains(where: { !axAmbientActions.contains($0) }) { return false }
    // Chromium reports AXValue as writable on almost every container, so
    // `settable` alone says nothing. Only trust it to mean "real control" when
    // the node is not a single-child pass-through.
    if settable, childCount != 1 { return false }
    // Inside web content a container holding several children is real structure
    // (a toolbar, a list), not scaffolding — keep it so siblings stay grouped.
    if insideWebArea, childCount > 1 { return false }
    return true
}

/// The one element the application reports as holding keyboard focus.
///
/// Each Chromium web view reports `AXFocused` inside its own subtree, so in a
/// window stacking several of them every view claims focus. Only the
/// application answers with a single element, which is what lets the outline
/// tell a visible page from one parked behind it.
private func axAppFocusedElement(_ app: AXUIElement) -> AXUIElement? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &raw) == .success,
          let value = raw,
          CFGetTypeID(value) == AXUIElementGetTypeID()
    else { return nil }
    return (value as! AXUIElement)
}

/// Node count of a full DFS walk. Deliberately mirrors `findByIndex` — including
/// its lack of a depth guard — because DFS indices must line up between the
/// snapshot and the later `ax_action` lookup even across pruned subtrees.
private func axSubtreeSize(_ el: AXUIElement) -> Int {
    var total = 1
    for child in axChildren(el) { total += axSubtreeSize(child) }
    return total
}

/// Walk one element into zero or more wire nodes.
///
/// Returns an array, not an optional, because an elided wrapper contributes its
/// children in its own place. `state.index` tracks the *uncompressed* DFS
/// position (the contract `ax_action` resolves against) while `state.count`
/// only counts nodes we actually emit, so the node budget is spent on content.
private func nodeDicts(
    el: AXUIElement,
    state: AxWalkState,
    depth: Int,
    insideWebArea: Bool,
    coordinateTransform: AxCoordinateTransform,
    focusedElement: AXUIElement?
) -> [[String: Any]] {
    if state.count >= state.cap {
        state.truncated = true
        return []
    }

    state.index += 1
    let idx = state.index

    let role = axRole(el)
    let name = axString(el, kAXTitleAttribute as String)
        ?? axString(el, kAXDescriptionAttribute as String)
        ?? axString(el, "AXLabel")
    let secure = role == "AXSecureTextField" || axString(el, kAXSubroleAttribute as String) == "AXSecureTextField"
    let value = secure ? nil : axValueString(el)

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

    let childElements = axChildren(el)
    // The root is the caller's chosen observation scope; never dissolve it.
    let elide = depth > 0 && axNodeIsElidableWrapper(
        role: role,
        name: name,
        value: value,
        actions: actions,
        settable: settable,
        childCount: childElements.count,
        insideWebArea: insideWebArea
    )
    if !elide { state.count += 1 }

    var kids: [[String: Any]] = []
    if depth < state.limits.maxDepth {
        let childrenInWebArea = insideWebArea || role == "AXWebArea"
        let shared = state.menuShare && depth == 0
        for (position, child) in childElements.enumerated() {
            if state.count >= state.cap {
                state.truncated = true
                break
            }
            let indexBefore = state.index
            let truncatedBefore = state.truncated
            if shared {
                state.softCap = state.count + max(12, (state.limits.maxNodes - state.count) / (childElements.count - position))
            }
            kids.append(contentsOf: nodeDicts(
                el: child, state: state, depth: depth + 1,
                insideWebArea: childrenInWebArea,
                coordinateTransform: coordinateTransform,
                focusedElement: focusedElement
            ))
            if shared {
                state.softCap = Int.max
                if state.truncated && !truncatedBefore { state.index = indexBefore + axSubtreeSize(child) }
            }
        }
    } else {
        // Depth-pruned subtree: still advance the index past it, or every node
        // emitted afterwards would resolve to the wrong element.
        if !childElements.isEmpty { state.truncated = true }
        for child in childElements { state.index += axSubtreeSize(child) }
    }

    if elide { return kids }

    var dict: [String: Any] = [
        "index": idx,
        "role": role,
        "actions": actions,
        "enabled": state.unvalidatedMenuFlags ? true : (axBool(el, kAXEnabledAttribute as String) ?? true),
        "focused": axBool(el, kAXFocusedAttribute as String) ?? false,
        "settable": settable,
        "secure": secure,
    ]
    if let focusedElement, CFEqual(el, focusedElement) { dict["appFocused"] = true }
    if ["AXRow", "AXCell", "AXImage", "AXListItem"].contains(role), axCanSelect(el) {
        dict["selectable"] = true
        if let selected = axItemSelected(el) { dict["selected"] = selected }
    }
    if actions.contains(where: { ["axopen", "open"].contains($0.lowercased()) }), let itemKind = axItemKind(el) {
        dict["itemKind"] = itemKind
    }
    // A collapsed control hides whatever is behind it, and "Expand" is a
    // different offer from "Click" — the web line gained 0.16 → 0.53 on that
    // wording alone. AppKit splits the flag in two: AXExpanded on popups,
    // combo boxes and disclosure triangles, AXDisclosing on outline rows.
    // AXExpanded only: an AppKit outline row answers AXDisclosing whether or not
    // it can disclose anything, so reading that too labelled all 90 sidebar rows
    // of System Settings collapsed and the loop offered to "Expand Wi-Fi".
    // An AXMenuItem answers AXExpanded=false whether or not it has a submenu,
    // so a leaf command read as collapsed: Finder's View ▸ Sort By ▸ Date
    // Modified was offered as "Expand Date Modified" after it had already been
    // chosen, and the loop kept pressing it. Only an item with a submenu can
    // expand; the check mark is what a chosen item shows instead.
    if role == "AXMenuItem" {
        if childElements.contains(where: { axRole($0) == "AXMenu" }), let expanded = axBool(el, "AXExpanded") {
            dict["expanded"] = expanded
        }
        if let mark = axString(el, "AXMenuItemMarkChar") {
            dict["checked"] = !mark.isEmpty
        }
    } else if let expanded = axBool(el, "AXExpanded") {
        dict["expanded"] = expanded
    } else if role == "AXDisclosureTriangle", let value, let state = Int(value) {
        // An AppKit disclosure triangle (Finder's list view, outline rows)
        // answers no AXExpanded at all; its AXValue is the state, 0 or 1.
        dict["expanded"] = state != 0
    }
    // An outline lists nested rows flat, in order; the depth is the one thing
    // that says which folder a row is inside. Finder's list view shows a file
    // just moved into an expanded folder as the row under it, indented — read
    // without the level it was the same row as before the move.
    if role == "AXRow", let level = axInt(el, "AXDisclosureLevel"), level > 0 {
        dict["level"] = level
    }
    if let name, !name.isEmpty { dict["name"] = name }
    if let value, !value.isEmpty {
        // Cap value length to keep wire JSON small.
        dict["value"] = value.count > 500 ? String(value.prefix(500)) : value
    }
    if let bounds { dict["bounds"] = bounds }
    if !kids.isEmpty { dict["children"] = kids }
    return [dict]
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

func axAttributeElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
          let raw else { return nil }
    return (raw as! AXUIElement)
}

/// The deepest element of the app under a screen point, as the app's own
/// hit-test reports it — the window itself for a point on its frame.
func axElementAt(pid: pid_t, point: CGPoint) -> AXUIElement? {
    var element: AXUIElement?
    let app = AXUIElementCreateApplication(pid)
    guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &element) == .success else {
        return nil
    }
    return element
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

/// Smaller than this and a window is a title bar accessory, not a root: the
/// window-sharing indicator macOS puts on a captured window's title bar is a
/// 66×20 layer-0 window of its own, an AXDialog titled "Window", and it
/// appears on every window this helper screenshots.
let axRootMinimumSize = CGSize(width: 80, height: 24)

func discoverAxTransientRoots(
    pid: pid_t,
    includeDescendants: Bool,
    messagingTimeout: Float = axDefaultMessagingTimeout
) -> [AxTransientRoot] {
    guard axTrusted() else { return [] }
    let app = axApplication(pid, timeout: messagingTimeout)
    var elements: [AXUIElement] = []

    func appendCandidate(_ element: AXUIElement) {
        // Children do not inherit the app element's timeout — set it as we go, or
        // a partially responsive app stalls the walk one node at a time.
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        if elements.contains(where: { CFEqual($0, element) }) { return }
        let metadata = windowMetadata(element)
        // Floating panels (for example Fonts) use a nonzero CG window layer,
        // so the ordinary layer-zero window inventory does not include them.
        // Keep their non-modal window classification while registering an AX root.
        let floating = metadata.role == "AXWindow" && metadata.subrole == "AXFloatingWindow"
        // A title bar accessory was listed as a dialog root the model then
        // went looking into. No sheet, dialog or popover a person can act in
        // is that small.
        guard (classifyAxWindow(metadata).kind != "window" || floating),
              axBool(element, "AXVisible") != false,
              let frame = axFrame(element),
              frame.width >= axRootMinimumSize.width, frame.height >= axRootMinimumSize.height else { return }
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
    windowTitle: String? = nil,
    messagingTimeout: Float = axDefaultMessagingTimeout
) throws -> AxWindowMetadata {
    let geometry = try liveWindowGeometry(windowId: windowId)
    guard geometry.pid == Int(pid) else {
        throw HelperError(
            code: "AX_WINDOW_NOT_FOUND",
            message: "Window \(windowId) does not belong to pid \(pid)"
        )
    }

    let windows = axWindows(app: axApplication(pid, timeout: messagingTimeout))
    let boundsMatches = windows.filter {
        AXUIElementSetMessagingTimeout($0, messagingTimeout)
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

func resolveAxRoot(
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

// MARK: - Chromium / Electron lazy accessibility

/// Chromium keeps its accessibility tree unbuilt until an assistive technology
/// asks for it, so an Electron window that renders fine reports a handful of
/// empty `AXGroup`s and no `AXWebArea` at all. Electron documents
/// `AXManualAccessibility` as the opt-in switch; `AXEnhancedUserInterface` is
/// the older AppKit-side equivalent some Chromium builds still honour.
///
/// Both are per-process and sticky, which is also why the bug looked flaky:
/// once any other tool (VoiceOver, a dictation app, another agent) flipped the
/// switch, our snapshots started working for that process only.
final class ChromiumAccessibilityActivator: @unchecked Sendable {
    static let shared = ChromiumAccessibilityActivator()

    private let lock = NSLock()
    private var activated = Set<String>()
    private var chromiumByProcess: [String: Bool] = [:]

    /// Returns true when this call flipped the switch on a Chromium app — the
    /// only case where an empty tree is worth waiting on.
    func activate(pid: pid_t, app: AXUIElement) -> Bool {
        let running = NSRunningApplication(processIdentifier: pid)
        // Keyed by launch date as well as pid: a recycled pid is a different
        // process and must be activated again.
        let key = "\(pid):\(running?.launchDate?.timeIntervalSince1970 ?? 0)"

        lock.lock()
        let alreadyActivated = activated.contains(key)
        lock.unlock()
        guard !alreadyActivated else { return false }

        // The two attributes are alternative spellings of the same switch, and
        // which one a build answers to varies. Either landing is enough.
        let manual = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        let enhanced = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        guard manual == .success || enhanced == .success else {
            // An app that is still launching answers .cannotComplete. Leaving the
            // key uncached is what lets the next snapshot try again instead of
            // writing the process off for its whole lifetime.
            return false
        }

        lock.lock()
        activated.insert(key)
        lock.unlock()
        return isChromium(key: key, bundleURL: running?.bundleURL)
    }

    private func isChromium(key: String, bundleURL: URL?) -> Bool {
        lock.lock()
        let cached = chromiumByProcess[key]
        lock.unlock()
        if let cached { return cached }

        var result = false
        if let bundleURL {
            let frameworks = bundleURL.appendingPathComponent("Contents/Frameworks").path
            let entries = (try? FileManager.default.contentsOfDirectory(atPath: frameworks)) ?? []
            result = entries.contains {
                $0.hasSuffix(".framework")
                    && ($0.contains("Electron") || $0.contains("Chromium") || $0.contains("Chrome"))
            }
        }

        lock.lock()
        chromiumByProcess[key] = result
        lock.unlock()
        return result
    }
}

/// How long a freshly-activated Chromium app may take to publish its tree.
private let axChromiumSettleTimeout: TimeInterval = 2.5
private let axChromiumSettlePoll: TimeInterval = 0.15

/// True once the tree carries web content — the signal that Chromium finished
/// building it. Native chrome (title bar, menus) shows up long before this.
private func axContainsWebArea(_ el: AXUIElement, depth: Int = 0) -> Bool {
    if depth > 24 { return false }
    if axRole(el) == "AXWebArea" { return true }
    for child in axChildren(el) where axContainsWebArea(child, depth: depth + 1) { return true }
    return false
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
    let app = axApplication(pid)
    let needsSettle = ChromiumAccessibilityActivator.shared.activate(pid: pid, app: app)

    func tryResolveRoot() -> AXUIElement? {
        try? resolveAxRoot(
            app: app,
            pid: pid,
            axRootId: axRootId,
            windowId: windowId,
            windowTitle: windowTitle
        )
    }

    var candidate = tryResolveRoot()
    if needsSettle {
        // Chromium publishes its tree asynchronously after activation. Until it
        // does the app may expose no AXWindows at all, so root resolution fails
        // too — poll both. Web content appearing is the definitive signal; a
        // tree that stops growing is the fallback, because an Electron app's
        // native windows (file panels, alerts) never grow an AXWebArea and must
        // not burn the whole timeout.
        let deadline = Date().addingTimeInterval(axChromiumSettleTimeout)
        while Date() < deadline {
            if let candidate {
                if axContainsWebArea(candidate) { break }
                // Sheets, dialogs, menus and popovers are native AppKit chrome
                // even inside an Electron app — they never grow a web area, so
                // waiting on one would burn the whole timeout for nothing.
                if classifyAxWindow(windowMetadata(candidate)).kind != "window" { break }
            }
            Thread.sleep(forTimeInterval: axChromiumSettlePoll)
            candidate = tryResolveRoot()
        }
    }

    // Re-resolve on failure so the caller sees the real resolution error.
    let rootEl = try candidate ?? resolveAxRoot(
        app: app,
        pid: pid,
        axRootId: axRootId,
        windowId: windowId,
        windowTitle: windowTitle
    )

    let display = mainDisplaySizePoints()
    let coordinateTransform = AxCoordinateTransform(
        originX: captureX ?? 0,
        originY: captureY ?? 0,
        sourceWidth: captureSourceWidth ?? display.width,
        sourceHeight: captureSourceHeight ?? display.height,
        coordinateWidth: captureWidth ?? display.width,
        coordinateHeight: captureHeight ?? display.height
    )
    let focused = axAppFocusedElement(app)
    let menuState = AxWalkState(limits: AxWalkLimits(maxNodes: min(250, max(1, maxNodes / 3)), maxDepth: max(1, maxDepth)))
    menuState.menuShare = true
    let menu: [String: Any]?
    if axRootId == nil, axRole(rootEl) == "AXWindow", let menuBar = axMenuBar(app) {
        // Cocoa exposes command subtrees while menus are closed, and `ax_action`
        // presses a command in them directly. A background app validates its
        // menus only once it believes it is active, so it is told so for the
        // walk — and stays told for the press that usually follows.
        let background = NSWorkspace.shared.frontmostApplication?.processIdentifier != pid
        menuState.unvalidatedMenuFlags = background && !SyntheticActivationLease.hold(pid: pid, windowId: windowId.map { CGWindowID($0) })
        menu = nodeDicts(el: menuBar, state: menuState, depth: 0, insideWebArea: false,
                         coordinateTransform: coordinateTransform, focusedElement: focused).first
    } else {
        menu = nil
    }
    let state = AxWalkState(limits: AxWalkLimits(maxNodes: max(1, maxNodes - menuState.count), maxDepth: max(1, maxDepth)))
    let nodes = nodeDicts(
        el: rootEl, state: state, depth: 0, insideWebArea: false,
        coordinateTransform: coordinateTransform,
        focusedElement: focused
    )
    guard let tree = nodes.first else {
        throw HelperError(code: "AX_EMPTY", message: "No accessibility nodes for pid \(pid)")
    }
    var result: [String: Any] = [
        "tree": tree,
        "nodeCount": state.count + menuState.count,
        "truncated": state.truncated || menuState.truncated,
        "maxNodes": maxNodes,
        "maxDepth": maxDepth,
        "display": ["width": display.width, "height": display.height],
        "pid": Int(pid),
    ]
    if let menu { result["menuBar"] = menu }
    return result
}

/// Re-walk tree to find the Nth DFS node (1-based index matching snapshot).
