import AppKit

/// Insert nodes before the target so DFS index drifts between observe and act.
final class S10StaleRef: LabScenario {
    let id = "S10"
    let title = "Stale Ref Recovery"
    let summary = "Mutate tree so DFS index of Target shifts; recovery must re-bind."
    let tools = ["computer_snapshot", "computer_act"]
    let deliveries = ["semantic"]

    private var sink: ((String) -> Void)?
    private var hostStack: NSStackView!
    private var targetButton: NSButton!
    private var inserts: [NSView] = []
    private var hitCount = 0

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        hitCount = 0
        inserts = []
        statusSink("Target at stable role; inserts=0")

        let mutate = LabUI.button("Insert Decoy Nodes", id: "cu.lab.s10.mutate", target: self, action: #selector(mutate))
        targetButton = LabUI.button("Target", id: "cu.lab.s10.target", target: self, action: #selector(hitTarget))
        let clear = LabUI.button("Clear Decoys", id: "cu.lab.s10.clear", target: self, action: #selector(clearDecoys))

        hostStack = LabUI.vstack([
            LabUI.label("Decoy zone (grows upward in AX order)"),
            targetButton,
        ], spacing: 8)
        hostStack.labID("cu.lab.s10.stack")

        let stack = LabUI.vstack([
            LabUI.card("Controls", body: LabUI.hstack([mutate, clear], spacing: 8)),
            LabUI.card("Tree", body: hostStack),
            LabUI.label(
                "1) snapshot · 2) Insert Decoy Nodes · 3) press old @eN for Target — expect recovery via role/name/bounds, not raw index.",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s10.stage", stack)
    }

    func reset() {
        clearDecoys()
        hitCount = 0
        sink?("Target ready · inserts=0 · reset")
    }

    @objc private func mutate() {
        let n = inserts.count + 1
        let decoy = LabUI.label("Decoy \(n)", size: 12)
        decoy.labID("cu.lab.s10.decoy.\(n)", label: "Decoy \(n)")
        // Insert above Target so DFS index of Target increases.
        hostStack.insertArrangedSubview(decoy, at: max(0, hostStack.arrangedSubviews.count - 1))
        inserts.append(decoy)
        sink?("inserts=\(inserts.count) · Target index shifted")
    }

    @objc private func clearDecoys() {
        for v in inserts { hostStack?.removeArrangedSubview(v); v.removeFromSuperview() }
        inserts.removeAll()
        sink?("inserts=0")
    }

    @objc private func hitTarget() {
        hitCount += 1
        sink?("Target hit #\(hitCount)")
        targetButton.title = "Target · hit \(hitCount)"
        targetButton.setAccessibilityLabel(targetButton.title)
    }
}
