import AppKit

/// Async Loading → Ready for computer_wait_for.
final class S06WaitFor: LabScenario {
    let id = "S06"
    let title = "Wait For"
    let summary = "Start transitions Loading → Ready after ~0.6s for wait_for."
    let tools = ["computer_wait_for", "computer_act"]
    let deliveries = ["semantic"]

    private var sink: ((String) -> Void)?
    private var statusLabel: NSTextField!
    private var startButton: NSButton!
    private var workItem: DispatchWorkItem?

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("State: Loading")

        statusLabel = LabUI.label("Loading", size: 20, weight: .semibold)
        statusLabel.labID("cu.lab.s06.status", label: "Loading")
        statusLabel.setAccessibilityValue("Loading")

        startButton = LabUI.button("Start", id: "cu.lab.s06.start", target: self, action: #selector(start))

        let stack = LabUI.vstack([
            LabUI.card("Async transition", body: LabUI.vstack([statusLabel, startButton], spacing: 12)),
            LabUI.label(
                "press Start → wait_for textEquals/textContains Ready on cu.lab.s06.status (timeout ≥ 2000ms).",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s06.stage", stack)
    }

    func reset() {
        workItem?.cancel()
        workItem = nil
        startButton?.isEnabled = true
        setStatus("Loading")
        sink?("State: Loading · reset")
    }

    @objc private func start() {
        startButton.isEnabled = false
        setStatus("Loading")
        sink?("Transitioning…")
        let item = DispatchWorkItem { [weak self] in
            self?.setStatus("Ready")
            self?.sink?("State: Ready")
            self?.startButton.isEnabled = true
        }
        workItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: item)
    }

    private func setStatus(_ value: String) {
        statusLabel?.stringValue = value
        statusLabel?.setAccessibilityLabel(value)
        statusLabel?.setAccessibilityValue(value)
    }
}
