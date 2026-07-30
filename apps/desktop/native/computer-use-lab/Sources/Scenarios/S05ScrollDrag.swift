import AppKit

/// Scroll wheel target + drag handle for app-directed delivery.
final class S05ScrollDrag: LabScenario {
    let id = "S05"
    let title = "Scroll / Drag"
    let summary = "Scrollable list and draggable knob for app-directed input."
    let tools = ["computer_act"]
    let deliveries = ["app-directed", "physical"]

    private var sink: ((String) -> Void)?
    private var scrollInfo: NSTextField!
    private var dragInfo: NSTextField!
    private var scrollView: NSScrollView!
    private var knob: DragKnobView!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("Scroll y=0 · drag at origin")

        scrollInfo = LabUI.label("scroll offset: 0", size: 12)
        scrollInfo.labID("cu.lab.s05.scrollInfo", label: "scroll offset: 0")

        let doc = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 900))
        for i in 0..<30 {
            let row = LabUI.label("Row \(i) — scroll target content", size: 13)
            row.frame = NSRect(x: 12, y: CGFloat(870 - i * 30), width: 330, height: 24)
            row.labID("cu.lab.s05.row.\(i)", label: "Row \(i)")
            doc.addSubview(row)
        }
        scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder
        scrollView.documentView = doc
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.heightAnchor.constraint(equalToConstant: 180).isActive = true
        scrollView.widthAnchor.constraint(equalToConstant: 380).isActive = true
        scrollView.labID("cu.lab.s05.scroll", label: "Scroll area")
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(scrollMoved),
            name: NSView.boundsDidChangeNotification,
            object: scrollView.contentView
        )

        dragInfo = LabUI.label("drag: (0, 0)", size: 12)
        dragInfo.labID("cu.lab.s05.dragInfo", label: "drag: (0, 0)")

        let pad = NSView()
        pad.wantsLayer = true
        pad.layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.15).cgColor
        pad.layer?.cornerRadius = 8
        pad.translatesAutoresizingMaskIntoConstraints = false
        pad.heightAnchor.constraint(equalToConstant: 140).isActive = true
        pad.widthAnchor.constraint(equalToConstant: 380).isActive = true
        pad.labID("cu.lab.s05.dragPad", label: "Drag pad")

        knob = DragKnobView(frame: NSRect(x: 20, y: 50, width: 44, height: 44))
        knob.labID("cu.lab.s05.knob", label: "Drag knob")
        knob.onMove = { [weak self] p in
            let text = String(format: "drag: (%.0f, %.0f)", p.x, p.y)
            self?.dragInfo.stringValue = text
            self?.dragInfo.setAccessibilityLabel(text)
            self?.sink?(text)
        }
        pad.addSubview(knob)

        let stack = LabUI.vstack([
            LabUI.card("Scroll", body: LabUI.vstack([scrollInfo, scrollView], spacing: 8)),
            LabUI.card("Drag", body: LabUI.vstack([dragInfo, pad], spacing: 8)),
            LabUI.label("Prefer delivery=app-directed scroll/drag. physical only if needed.", size: 12),
        ], spacing: 14)
        return LabUI.stage("cu.lab.s05.stage", stack)
    }

    func reset() {
        if let doc = scrollView?.documentView {
            scrollView.contentView.scroll(to: NSPoint(x: 0, y: max(0, doc.bounds.height - scrollView.contentView.bounds.height)))
        }
        knob?.frame.origin = NSPoint(x: 20, y: 50)
        scrollInfo?.stringValue = "scroll offset: 0"
        dragInfo?.stringValue = "drag: (0, 0)"
        sink?("Scroll y=0 · drag at origin · reset")
    }

    @objc private func scrollMoved() {
        let y = scrollView.contentView.bounds.origin.y
        let text = String(format: "scroll offset: %.0f", y)
        scrollInfo.stringValue = text
        scrollInfo.setAccessibilityLabel(text)
        sink?(text)
    }
}

final class DragKnobView: NSView {
    var onMove: ((NSPoint) -> Void)?
    private var dragging = false

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.systemBlue.cgColor
        layer?.cornerRadius = 8
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func mouseDown(with event: NSEvent) {
        dragging = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragging, let parent = superview else { return }
        let p = parent.convert(event.locationInWindow, from: nil)
        var origin = NSPoint(x: p.x - bounds.width / 2, y: p.y - bounds.height / 2)
        origin.x = min(max(0, origin.x), parent.bounds.width - bounds.width)
        origin.y = min(max(0, origin.y), parent.bounds.height - bounds.height)
        frame.origin = origin
        onMove?(origin)
    }

    override func mouseUp(with event: NSEvent) {
        dragging = false
    }
}
