import AppKit

/// Two windows with the same title — forces root disambiguation beyond title.
final class S08DualWindow: LabScenario {
    let id = "S08"
    let title = "Dual Window"
    let summary = "Second window shares title; distinguish via windowId / content."
    let tools = ["computer_apps", "computer_snapshot", "computer_act"]
    let deliveries = ["semantic", "app-directed"]

    private var sink: ((String) -> Void)?
    private var twin: NSWindow?
    private var primaryMark: NSTextField!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Single window")

        primaryMark = LabUI.label("Primary pane · token=ALPHA", size: 15, weight: .medium)
        primaryMark.labID("cu.lab.s08.primary", label: "Primary pane · token=ALPHA")

        let open = LabUI.button("Open Twin Window", id: "cu.lab.s08.openTwin", target: self, action: #selector(openTwin))
        let close = LabUI.button("Close Twin", id: "cu.lab.s08.closeTwin", target: self, action: #selector(closeTwin))

        let stack = LabUI.vstack([
            LabUI.card("Primary (this window title stays SuperOne CU Lab)", body: primaryMark),
            LabUI.card("Twin", body: LabUI.hstack([open, close], spacing: 8)),
            LabUI.label(
                "Twin reuses title \"SuperOne CU Lab\" on purpose. Distinguish via token=BETA content or windowId (includeRoots).",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s08.stage", stack)
    }

    func reset() {
        closeExtras()
        sink?("Single window · reset")
    }

    func closeExtras() {
        twin?.close()
        twin = nil
    }

    @objc private func openTwin() {
        if twin != nil { return }
        let w = NSWindow(
            contentRect: NSRect(x: 120, y: 120, width: 420, height: 240),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        // Intentionally same product family name + nearly identical chrome;
        // unique marker lives in content for agents that disambiguate wrongly by title alone.
        w.title = "SuperOne CU Lab"
        let mark = LabUI.label("Twin pane · token=BETA", size: 16, weight: .semibold)
        mark.labID("cu.lab.s08.twin", label: "Twin pane · token=BETA")
        let close = LabUI.button("Close Twin", id: "cu.lab.s08.twinClose", target: self, action: #selector(closeTwin))
        let stack = LabUI.vstack([mark, close], spacing: 16)
        let content = NSView()
        LabUI.pinned(stack, in: content)
        w.contentView = content
        w.isReleasedWhenClosed = false
        twin = w
        w.makeKeyAndOrderFront(nil)
        sink?("Twin open · token=BETA")
    }

    @objc private func closeTwin() {
        twin?.close()
        twin = nil
        sink?("Twin closed")
    }
}
