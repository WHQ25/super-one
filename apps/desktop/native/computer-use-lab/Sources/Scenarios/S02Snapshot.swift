import AppKit

/// Deep, labeled tree for computer_snapshot (visual/semantic/fused) + computer_query.
final class S02Snapshot: LabScenario {
    let id = "S02"
    let title = "Snapshot / Query"
    let summary = "Deep AX outline + visible chrome for fused/semantic/visual modes."
    let tools = ["computer_snapshot", "computer_query", "computer_zoom"]
    let deliveries = ["n/a"]

    private var sink: ((String) -> Void)?

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Snapshot stage ready · search for 'Needle'")

        let header = LabUI.label("Snapshot Forest", size: 18, weight: .semibold)
        header.labID("cu.lab.s02.header", label: "Snapshot Forest")

        let needle = LabUI.label("Needle", size: 14, weight: .bold)
        needle.textColor = .systemOrange
        needle.labID("cu.lab.s02.needle", label: "Needle")

        var leaves: [NSView] = []
        for i in 1...12 {
            let leaf = LabUI.label("Leaf \(i)", size: 12)
            leaf.labID("cu.lab.s02.leaf.\(i)", label: "Leaf \(i)")
            leaves.append(leaf)
        }
        let branchA = LabUI.card("Branch Alpha", body: LabUI.vstack(Array(leaves.prefix(6)), spacing: 4))
        branchA.labID("cu.lab.s02.branch.alpha")
        let branchB = LabUI.card(
            "Branch Beta",
            body: LabUI.vstack(Array(leaves.suffix(6)) + [needle], spacing: 4)
        )
        branchB.labID("cu.lab.s02.branch.beta")

        let swatch = NSView()
        swatch.wantsLayer = true
        swatch.layer?.backgroundColor = NSColor.systemTeal.withAlphaComponent(0.35).cgColor
        swatch.layer?.cornerRadius = 6
        swatch.translatesAutoresizingMaskIntoConstraints = false
        swatch.heightAnchor.constraint(equalToConstant: 72).isActive = true
        swatch.widthAnchor.constraint(equalToConstant: 220).isActive = true
        swatch.labID("cu.lab.s02.swatch", label: "Teal swatch")

        let stack = LabUI.vstack([
            header,
            LabUI.label("Use mode=semantic for outline, fused for image+AX, visual for pixels only."),
            LabUI.hstack([branchA, branchB], spacing: 12),
            LabUI.card("Visual target", body: swatch),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s02.stage", stack)
    }

    func reset() {
        sink?("Snapshot stage ready · reset")
    }
}
