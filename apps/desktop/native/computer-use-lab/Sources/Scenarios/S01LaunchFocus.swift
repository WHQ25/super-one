import AppKit

/// Proves computer_apps list/launch/focus against a fixed bundle id + title.
final class S01LaunchFocus: LabScenario {
    let id = "S01"
    let title = "Launch / Focus"
    let summary = "Stable app identity for computer_apps list, launch, focus."
    let tools = ["computer_apps"]
    let deliveries = ["n/a"]

    private var sink: ((String) -> Void)?
    private var pulse = 0

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Lab Ready · bundleId com.superone.computer-use.lab")

        let badge = LabUI.label("SuperOne CU Lab", size: 22, weight: .bold)
        badge.labID("cu.lab.s01.title", label: "SuperOne CU Lab")

        let body = LabUI.label(
            "Use computer_apps with app=com.superone.computer-use.lab or query=CU Lab.\n"
                + "list should show running=true after launch.\n"
                + "focus should not change this stage content.",
            size: 13
        )
        body.labID("cu.lab.s01.body")

        let ping = LabUI.button("Ping Status", id: "cu.lab.s01.ping", target: self, action: #selector(ping))
        let stack = LabUI.vstack([
            LabUI.card("Identity", body: LabUI.vstack([badge, body], spacing: 8)),
            LabUI.card("Smoke", body: ping),
        ], spacing: 16)
        return LabUI.stage("cu.lab.s01.stage", stack)
    }

    func reset() {
        pulse = 0
        sink?("Lab Ready · reset")
    }

    @objc private func ping() {
        pulse += 1
        sink?("Ping #\(pulse) · still focused")
    }
}
