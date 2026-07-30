import AppKit

/// Large painted hit zones for coordinate click (app-directed / physical).
final class S11Coordinate: LabScenario {
    let id = "S11"
    let title = "Coordinate Click"
    let summary = "Three colored zones with known labels for x,y clicks."
    let tools = ["computer_act", "computer_snapshot"]
    let deliveries = ["app-directed", "physical"]

    private var sink: ((String) -> Void)?
    private var result: NSTextField!
    private var zones: [HitZoneView] = []

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("No zone hit")

        result = LabUI.label("last zone: none", size: 14, weight: .medium)
        result.labID("cu.lab.s11.result", label: "last zone: none")

        let row = LabUI.hstack([], spacing: 16)
        let specs: [(String, NSColor, String)] = [
            ("A", .systemRed, "cu.lab.s11.zone.a"),
            ("B", .systemGreen, "cu.lab.s11.zone.b"),
            ("C", .systemBlue, "cu.lab.s11.zone.c"),
        ]
        zones = []
        for (name, color, ax) in specs {
            let z = HitZoneView(name: name, color: color)
            z.labID(ax, label: "Zone \(name)")
            z.translatesAutoresizingMaskIntoConstraints = false
            z.widthAnchor.constraint(equalToConstant: 100).isActive = true
            z.heightAnchor.constraint(equalToConstant: 100).isActive = true
            z.onHit = { [weak self] n in
                let text = "last zone: \(n)"
                self?.result.stringValue = text
                self?.result.setAccessibilityLabel(text)
                self?.result.setAccessibilityValue(n)
                self?.sink?(text)
            }
            zones.append(z)
            row.addArrangedSubview(z)
        }

        let stack = LabUI.vstack([
            LabUI.card("Zones", body: row),
            LabUI.card("Result", body: result),
            LabUI.label(
                "snapshot fused → click center of Zone B via coordinates (app-directed). semantic press on zone refs also works.",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s11.stage", stack)
    }

    func reset() {
        result?.stringValue = "last zone: none"
        result?.setAccessibilityLabel("last zone: none")
        sink?("No zone hit · reset")
    }
}

final class HitZoneView: NSView {
    let name: String
    var onHit: ((String) -> Void)?

    init(name: String, color: NSColor) {
        self.name = name
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = color.withAlphaComponent(0.75).cgColor
        layer?.cornerRadius = 10
        let label = LabUI.label(name, size: 28, weight: .bold)
        label.alignment = .center
        label.textColor = .white
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func mouseDown(with event: NSEvent) {
        onHit?(name)
    }
}
