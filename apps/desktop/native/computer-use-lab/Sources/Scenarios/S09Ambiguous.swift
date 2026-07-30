import AppKit

/// Multiple controls with identical role+name — recovery must not guess.
final class S09Ambiguous: LabScenario {
    let id = "S09"
    let title = "Ambiguous Controls"
    let summary = "Three Save buttons share name; only accessibilityIdentifier differs."
    let tools = ["computer_act", "computer_query"]
    let deliveries = ["semantic"]

    private var sink: ((String) -> Void)?
    private var result: NSTextField!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("No Save pressed")

        result = LabUI.label("last: none", size: 14, weight: .medium)
        result.labID("cu.lab.s09.result", label: "last: none")

        let a = LabUI.button("Save", id: "cu.lab.s09.save.a", target: self, action: #selector(saveA))
        let b = LabUI.button("Save", id: "cu.lab.s09.save.b", target: self, action: #selector(saveB))
        let c = LabUI.button("Save", id: "cu.lab.s09.save.c", target: self, action: #selector(saveC))
        // Keep displayed title identical; identifiers differ (already set).

        let stack = LabUI.vstack([
            LabUI.card("Identical titles", body: LabUI.hstack([a, b, c], spacing: 12)),
            LabUI.card("Result", body: result),
            LabUI.label(
                "Inspect identifiers cu.lab.s09.save.{a,b,c}. Stale ref without unique fingerprint should fail closed.",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s09.stage", stack)
    }

    func reset() {
        setResult("none")
        sink?("No Save pressed · reset")
    }

    @objc private func saveA() { setResult("A"); sink?("Save A") }
    @objc private func saveB() { setResult("B"); sink?("Save B") }
    @objc private func saveC() { setResult("C"); sink?("Save C") }

    private func setResult(_ which: String) {
        let text = "last: \(which)"
        result?.stringValue = text
        result?.setAccessibilityLabel(text)
        result?.setAccessibilityValue(which)
    }
}
