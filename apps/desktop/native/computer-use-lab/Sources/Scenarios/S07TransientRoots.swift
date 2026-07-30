import AppKit

/// Sheet / menu / popover roots for multi-root discovery.
final class S07TransientRoots: LabScenario {
    let id = "S07"
    let title = "Modal / Sheet / Menu"
    let summary = "AppKit sheet, menu, and popover as transient UI roots."
    let tools = ["computer_apps", "computer_snapshot", "computer_act"]
    let deliveries = ["semantic", "app-directed"]

    private var sink: ((String) -> Void)?
    private weak var parentWindow: NSWindow?
    private var sheet: NSWindow?
    private var popover: NSPopover?
    private var note: NSTextField!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("No transient root open")

        note = LabUI.label("Parent window content", size: 14)
        note.labID("cu.lab.s07.parentLabel", label: "Parent window content")

        let openSheet = LabUI.button("Open Sheet", id: "cu.lab.s07.openSheet", target: self, action: #selector(openSheet))
        let openMenu = LabUI.button("Open Menu", id: "cu.lab.s07.openMenu", target: self, action: #selector(openMenu(_:)))
        let openPopover = LabUI.button("Open Popover", id: "cu.lab.s07.openPopover", target: self, action: #selector(openPopover(_:)))

        let stack = LabUI.vstack([
            LabUI.card("Parent", body: note),
            LabUI.card("Open", body: LabUI.hstack([openSheet, openMenu, openPopover], spacing: 8)),
            LabUI.label("Snapshot after open should expose sheet/menu/popover roots; close via labeled buttons.", size: 12),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s07.stage", stack)
    }

    func reset() {
        closeExtras()
        note?.stringValue = "Parent window content"
        sink?("No transient root open · reset")
    }

    func closeExtras() {
        if let sheet {
            parentWindow?.endSheet(sheet)
            self.sheet = nil
        }
        popover?.close()
        popover = nil
    }

    @objc private func openSheet() {
        guard sheet == nil else { return }
        parentWindow = NSApp.keyWindow ?? NSApp.mainWindow
        guard let parentWindow else {
            sink?("No parent window")
            return
        }
        let candidate = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 180),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        candidate.title = "CU Lab Sheet"
        let label = LabUI.label("Sheet Content", size: 15, weight: .medium)
        label.labID("cu.lab.s07.sheetContent", label: "Sheet Content")
        let close = LabUI.button("Close Sheet", id: "cu.lab.s07.closeSheet", target: self, action: #selector(closeSheet))
        let stack = LabUI.vstack([label, close], spacing: 16)
        let content = NSView()
        LabUI.pinned(stack, in: content)
        candidate.contentView = content
        sheet = candidate
        parentWindow.beginSheet(candidate)
        sink?("Sheet open")
    }

    @objc private func closeSheet() {
        guard let sheet else { return }
        parentWindow?.endSheet(sheet)
        self.sheet = nil
        sink?("Sheet closed")
    }

    @objc private func openMenu(_ sender: NSButton) {
        let menu = NSMenu(title: "CU Lab Menu")
        let action = NSMenuItem(title: "Menu Action", action: #selector(menuAction), keyEquivalent: "")
        action.target = self
        action.setAccessibilityIdentifier("cu.lab.s07.menuAction")
        menu.addItem(action)
        menu.addItem(NSMenuItem(title: "Close Menu", action: nil, keyEquivalent: ""))
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height), in: sender)
        sink?("Menu shown")
    }

    @objc private func menuAction() {
        note.stringValue = "Menu Action Complete"
        note.setAccessibilityLabel("Menu Action Complete")
        sink?("Menu Action Complete")
    }

    @objc private func openPopover(_ sender: NSButton) {
        guard popover == nil else { return }
        let controller = NSViewController()
        let label = LabUI.label("Popover Content", size: 14)
        label.labID("cu.lab.s07.popoverContent", label: "Popover Content")
        let close = LabUI.button("Close Popover", id: "cu.lab.s07.closePopover", target: self, action: #selector(closePopover))
        let stack = LabUI.vstack([label, close], spacing: 12)
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 120))
        LabUI.pinned(stack, in: view, insets: 12)
        controller.view = view
        controller.preferredContentSize = NSSize(width: 280, height: 120)
        let candidate = NSPopover()
        candidate.behavior = .applicationDefined
        candidate.contentViewController = controller
        popover = candidate
        candidate.show(relativeTo: sender.bounds, of: sender, preferredEdge: .maxX)
        sink?("Popover open")
    }

    @objc private func closePopover() {
        popover?.close()
        popover = nil
        sink?("Popover closed")
    }
}
