import AppKit

/// setText / typeText with ASCII + CJK readback.
final class S04TextInput: LabScenario {
    let id = "S04"
    let title = "Text Input"
    let summary = "AX setText and keyboard typeText with CJK readback."
    let tools = ["computer_act"]
    let deliveries = ["semantic", "app-directed"]

    private var sink: ((String) -> Void)?
    private var field: NSTextField!
    private var mirror: NSTextField!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Text empty · try setText 中文")

        field = LabUI.field(placeholder: "Type here", id: "cu.lab.s04.field")
        field.font = .systemFont(ofSize: 15)
        field.translatesAutoresizingMaskIntoConstraints = false
        field.widthAnchor.constraint(greaterThanOrEqualToConstant: 320).isActive = true
        field.target = self
        field.action = #selector(edited)

        mirror = LabUI.label("mirror: (empty)", size: 13)
        mirror.labID("cu.lab.s04.mirror", label: "mirror: (empty)")

        let clear = LabUI.button("Clear", id: "cu.lab.s04.clear", target: self, action: #selector(clear))
        let fillCJK = LabUI.button("Seed CJK", id: "cu.lab.s04.seedCJK", target: self, action: #selector(seedCJK))
        let fillASCII = LabUI.button("Seed ASCII", id: "cu.lab.s04.seedASCII", target: self, action: #selector(seedASCII))

        let stack = LabUI.vstack([
            LabUI.card("Field", body: LabUI.vstack([field, mirror], spacing: 8)),
            LabUI.card("Helpers", body: LabUI.hstack([clear, fillCJK, fillASCII], spacing: 8)),
            LabUI.label(
                "semantic setText on cu.lab.s04.field · app-directed typeText after focus · expect mirror updates.",
                size: 12
            ),
        ], spacing: 14)
        let host = LabUI.stage("cu.lab.s04.stage", stack)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(edited),
            name: NSControl.textDidChangeNotification,
            object: field
        )
        return host
    }

    func reset() {
        field?.stringValue = ""
        updateMirror()
        sink?("Text empty · reset")
    }

    @objc private func edited() {
        updateMirror()
        sink?("Text length \(field.stringValue.count)")
    }

    @objc private func clear() {
        field.stringValue = ""
        updateMirror()
        sink?("Cleared")
    }

    @objc private func seedCJK() {
        field.stringValue = "苹果公司 · 中文测试"
        updateMirror()
        sink?("Seeded CJK")
    }

    @objc private func seedASCII() {
        field.stringValue = "hello superone"
        updateMirror()
        sink?("Seeded ASCII")
    }

    private func updateMirror() {
        let v = field?.stringValue ?? ""
        let text = v.isEmpty ? "mirror: (empty)" : "mirror: \(v)"
        mirror?.stringValue = text
        mirror?.setAccessibilityLabel(text)
        mirror?.setAccessibilityValue(v)
    }
}
