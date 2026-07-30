import AppKit

/// Semantic press: simple toggle + navigation where button label stays constant.
final class S03Press: LabScenario {
    let id = "S03"
    let title = "Press / Navigate"
    let summary = "AX press on labeled controls; history-style nav without label change."
    let tools = ["computer_act"]
    let deliveries = ["semantic"]

    private var sink: ((String) -> Void)?
    private var page: NSTextField!
    private var detail: NSTextField!
    private var pressed = false
    private var onHistory = false

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        pressed = false
        onHistory = false
        statusSink("Idle · press Toggle or History")

        let toggle = LabUI.button("Toggle", id: "cu.lab.s03.toggle", target: self, action: #selector(toggle))
        // Label intentionally stays "历史" after navigation (outcome-diff case).
        let history = LabUI.button("历史", id: "cu.lab.s03.history", target: self, action: #selector(openHistory))
        let home = LabUI.button("首页", id: "cu.lab.s03.home", target: self, action: #selector(goHome))

        page = LabUI.label("Page: Home", size: 16, weight: .semibold)
        page.labID("cu.lab.s03.page", label: "Page: Home")
        detail = LabUI.label("Feed item A · Feed item B · Feed item C", size: 13)
        detail.labID("cu.lab.s03.detail")

        let stack = LabUI.vstack([
            LabUI.card("Actions", body: LabUI.hstack([toggle, history, home], spacing: 10)),
            LabUI.card("Content", body: LabUI.vstack([page, detail], spacing: 8)),
            LabUI.label(
                "Prefer delivery=semantic press on @refs. Expect outcome=worked when History rewrites the outline even though 历史 label is unchanged.",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s03.stage", stack)
    }

    func reset() {
        pressed = false
        onHistory = false
        page?.stringValue = "Page: Home"
        page?.setAccessibilityLabel("Page: Home")
        detail?.stringValue = "Feed item A · Feed item B · Feed item C"
        sink?("Idle · reset")
    }

    @objc private func toggle() {
        pressed.toggle()
        sink?(pressed ? "Toggle: on" : "Toggle: off")
    }

    @objc private func openHistory() {
        onHistory = true
        page.stringValue = "Page: 观看历史"
        page.setAccessibilityLabel("Page: 观看历史")
        detail.stringValue = "清空历史 · 批量管理 · Episode 1 · Episode 2 · Episode 3"
        detail.setAccessibilityLabel(detail.stringValue)
        sink?("Navigated to 观看历史")
    }

    @objc private func goHome() {
        onHistory = false
        page.stringValue = "Page: Home"
        page.setAccessibilityLabel("Page: Home")
        detail.stringValue = "Feed item A · Feed item B · Feed item C"
        detail.setAccessibilityLabel(detail.stringValue)
        sink?("Navigated to Home")
    }
}
