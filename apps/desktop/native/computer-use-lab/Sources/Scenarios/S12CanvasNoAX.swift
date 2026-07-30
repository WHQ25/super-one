import AppKit

/// Custom-drawn canvas that hides child AX — forces coordinate / visual path.
final class S12CanvasNoAX: LabScenario {
    let id = "S12"
    let title = "Canvas / No AX"
    let summary = "Picture-like canvas without child accessibility nodes."
    let tools = ["computer_act", "computer_snapshot"]
    let deliveries = ["app-directed", "physical"]

    private var sink: ((String) -> Void)?
    private var canvas: NoAXCanvasView!
    private var readout: NSTextField!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Canvas idle · hits=0")

        readout = LabUI.label("hits=0 last=(none)", size: 13)
        readout.labID("cu.lab.s12.readout", label: "hits=0 last=(none)")

        canvas = NoAXCanvasView()
        canvas.translatesAutoresizingMaskIntoConstraints = false
        canvas.heightAnchor.constraint(equalToConstant: 200).isActive = true
        canvas.widthAnchor.constraint(equalToConstant: 420).isActive = true
        // Whole canvas is one AX image-like element; no children.
        canvas.setAccessibilityElement(true)
        canvas.setAccessibilityRole(.image)
        canvas.setAccessibilityIdentifier("cu.lab.s12.canvas")
        canvas.setAccessibilityLabel("No-AX canvas")
        canvas.onHit = { [weak self] p, n in
            let text = String(format: "hits=%d last=(%.0f,%.0f)", n, p.x, p.y)
            self?.readout.stringValue = text
            self?.readout.setAccessibilityLabel(text)
            self?.sink?(text)
        }

        let stack = LabUI.vstack([
            LabUI.card("Canvas", body: canvas),
            LabUI.card("Readout (AX-visible)", body: readout),
            LabUI.label(
                "Children are intentionally not in the AX tree. Click red circle via coordinates from fused snapshot. semantic cannot press the circle.",
                size: 12
            ),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s12.stage", stack)
    }

    func reset() {
        canvas?.resetHits()
        readout?.stringValue = "hits=0 last=(none)"
        readout?.setAccessibilityLabel("hits=0 last=(none)")
        sink?("Canvas idle · reset")
    }
}

final class NoAXCanvasView: NSView {
    var onHit: ((NSPoint, Int) -> Void)?
    private var hits = 0
    /// Circle center in view coords (bottom-left origin).
    private let circleCenter = NSPoint(x: 210, y: 100)
    private let circleRadius: CGFloat = 36

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        layer?.cornerRadius = 8
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.separatorColor.cgColor
        // Critical: do not expose synthesized child AX elements.
        setAccessibilityElement(true)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func isAccessibilityElement() -> Bool { true }

    override func accessibilityChildren() -> [Any]? { [] }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.controlBackgroundColor.setFill()
        bounds.fill()

        // Grid (visual only)
        NSColor.separatorColor.withAlphaComponent(0.4).setStroke()
        let grid = NSBezierPath()
        for x in stride(from: 0, through: bounds.width, by: 40) {
            grid.move(to: NSPoint(x: x, y: 0))
            grid.line(to: NSPoint(x: x, y: bounds.height))
        }
        for y in stride(from: 0, through: bounds.height, by: 40) {
            grid.move(to: NSPoint(x: 0, y: y))
            grid.line(to: NSPoint(x: bounds.width, y: y))
        }
        grid.lineWidth = 1
        grid.stroke()

        let circle = NSBezierPath(
            ovalIn: NSRect(
                x: circleCenter.x - circleRadius,
                y: circleCenter.y - circleRadius,
                width: circleRadius * 2,
                height: circleRadius * 2
            )
        )
        NSColor.systemRed.setFill()
        circle.fill()

        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.white,
            .font: NSFont.boldSystemFont(ofSize: 14),
        ]
        let str = "HIT" as NSString
        let size = str.size(withAttributes: attrs)
        str.draw(
            at: NSPoint(x: circleCenter.x - size.width / 2, y: circleCenter.y - size.height / 2),
            withAttributes: attrs
        )
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let dx = p.x - circleCenter.x
        let dy = p.y - circleCenter.y
        if dx * dx + dy * dy <= circleRadius * circleRadius {
            hits += 1
            onHit?(p, hits)
            needsDisplay = true
        }
    }

    func resetHits() {
        hits = 0
        needsDisplay = true
    }
}
