import ApplicationServices
import Foundation

private func axSelectionContainer(_ element: AXUIElement) -> AXUIElement? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &raw) == .success,
          let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    let parent = raw as! AXUIElement
    var settable: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(parent, kAXSelectedChildrenAttribute as CFString, &settable) == .success && settable.boolValue ? parent : nil
}

func axItemSelected(_ element: AXUIElement) -> Bool? {
    if let selected = axBool(element, kAXSelectedAttribute as String) { return selected }
    guard let parent = axSelectionContainer(element) else { return nil }
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(parent, kAXSelectedChildrenAttribute as CFString, &raw) == .success,
          let children = raw as? [AXUIElement] else { return nil }
    return children.contains { CFEqual($0, element) }
}

func axCanSelect(_ element: AXUIElement) -> Bool {
    guard ["AXRow", "AXCell", "AXImage", "AXListItem"].contains(axRole(element)) else { return false }
    var settable: DarwinBoolean = false
    if AXUIElementIsAttributeSettable(element, kAXSelectedAttribute as CFString, &settable) == .success && settable.boolValue { return true }
    if axSelectionContainer(element) != nil { return true }
    return ["AXRow", "AXCell"].contains(axRole(element)) && axActions(element).contains(kAXPressAction as String)
}

func axItemKind(_ element: AXUIElement) -> String? {
    var raw: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXURLAttribute as CFString, &raw) == .success else { return nil }
    let url = (raw as? URL) ?? (raw as? String).flatMap(URL.init(string:))
    guard let url, url.isFileURL,
          let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isPackageKey]),
          let directory = values.isDirectory else { return nil }
    // App bundles and document packages open in an application, not as folders.
    return directory && values.isPackage != true ? "folder" : "file"
}

func axSelectItem(_ element: AXUIElement) throws {
    guard axCanSelect(element) else {
        throw HelperError(code: "AX_NOT_SELECTABLE", message: "AXSelected is not settable on this item")
    }
    var settable: DarwinBoolean = false
    let result: AXError
    if AXUIElementIsAttributeSettable(element, kAXSelectedAttribute as CFString, &settable) == .success && settable.boolValue {
        result = AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue)
    } else if let parent = axSelectionContainer(element) {
        result = AXUIElementSetAttributeValue(parent, kAXSelectedChildrenAttribute as CFString, [element] as CFArray)
    } else {
        // The capability check permits AXPress selection only for rows/cells,
        // never for a file icon whose primary action might launch an app.
        result = AXUIElementPerformAction(element, kAXPressAction as CFString)
    }
    guard result == .success else {
        throw HelperError(code: "AX_ACTION", message: "AXSelect failed (\(result.rawValue))")
    }
}

func axOpenItem(_ element: AXUIElement) throws {
    guard let action = axActions(element).first(where: { ["axopen", "open"].contains($0.lowercased()) }) else {
        throw HelperError(code: "AX_NOT_OPENABLE", message: "This item has no native open action")
    }
    let result = AXUIElementPerformAction(element, action as CFString)
    guard result == .success else {
        throw HelperError(code: "AX_ACTION", message: "AXOpen failed (\(result.rawValue))")
    }
}
