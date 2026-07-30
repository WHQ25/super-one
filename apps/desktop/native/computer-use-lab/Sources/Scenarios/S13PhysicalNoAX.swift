import AppKit

/// Entire stage is custom-drawn with **zero** accessibility exposure — physical /
/// coordinate Computer Use only (like WeChat-style picture-only UIs).
final class S13PhysicalNoAX: LabScenario {
    let id = "S13"
    let title = "Physical / Zero AX"
    let summary = "No AX on stage: click, scroll, drag, type via physical / app-directed only."
    let tools = ["computer_snapshot", "computer_act"]
    let deliveries = ["physical", "app-directed"]

    private var sink: ((String) -> Void)?
    private var playfield: PhysicalPlayfieldView!

    func makeStage(statusSink: @escaping (String) -> Void) -> NSView {
        sink = statusSink
        statusSink("S13 zero-AX playfield · use physical")

        playfield = PhysicalPlayfieldView()
        playfield.translatesAutoresizingMaskIntoConstraints = false
        playfield.onStatus = { [weak self] text in
            self?.sink?(text)
        }
        // Do NOT wrap in LabUI.card / labels — those reintroduce AX nodes.
        // Fill the stage; outer chrome (sidebar/status) stays AX for navigation only.
        let host = NSView()
        host.translatesAutoresizingMaskIntoConstraints = false
        // Stage host itself should not be a useful AX target for content.
        host.setAccessibilityElement(false)
        host.setAccessibilityRole(.none)
        host.addSubview(playfield)
        NSLayoutConstraint.activate([
            playfield.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            playfield.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            playfield.topAnchor.constraint(equalTo: host.topAnchor),
            playfield.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            playfield.heightAnchor.constraint(greaterThanOrEqualToConstant: 420),
        ])
        host.labID("cu.lab.s13.stage")
        // Re-assert: identifier only, not a control.
        host.setAccessibilityElement(false)
        return host
    }

    func reset() {
        playfield?.resetAll()
        sink?("S13 reset · zero-AX playfield")
    }
}

// MARK: - Playfield (fully painted, AX-ignored)

/// All interaction targets are drawn pixels + AppKit mouse/key handlers.
/// No AX children, not an accessibility element — snapshot is picture-only for content.
final class PhysicalPlayfieldView: NSView {
    var onStatus: ((String) -> Void)?

    // Layout in view coordinates (isFlipped = true → top-left origin).
    private let clickA = NSRect(x: 24, y: 56, width: 100, height: 56)
    private let clickB = NSRect(x: 140, y: 56, width: 100, height: 56)
    private let clickC = NSRect(x: 256, y: 56, width: 100, height: 56)
    private let scrollArea = NSRect(x: 24, y: 140, width: 320, height: 180)
    private let dragPad = NSRect(x: 360, y: 140, width: 280, height: 180)
    private let typePad = NSRect(x: 24, y: 340, width: 616, height: 56)

    private var lastClick = "none"
    private var scrollOffset: CGFloat = 0
    private var knob = NSPoint(x: 40, y: 70) // relative to dragPad
    private var typed = ""
    private var typeFocused = false
    private var dragging = false

    private let rowH: CGFloat = 28
    private let rowCount = 40

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
        // Critical: disappear from AX tree entirely.
        setAccessibilityElement(false)
        setAccessibilityRole(.none)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func isAccessibilityElement() -> Bool { false }
    override func accessibilityChildren() -> [Any]? { nil }
    override func accessibilityHitTest(_ point: NSPoint) -> Any? { nil }
    override func accessibilityParent() -> Any? { nil }

    func resetAll() {
        lastClick = "none"
        scrollOffset = 0
        knob = NSPoint(x: 40, y: 70)
        typed = ""
        typeFocused = false
        dragging = false
        needsDisplay = true
        emit("reset · click=none scroll=0 drag=(40,70) type=\"\"")
    }

    private func emit(_ text: String) {
        onStatus?(text)
        needsDisplay = true
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.textBackgroundColor.setFill()
        bounds.fill()

        drawHeader()
        drawClickZone(clickA, title: "A", color: .systemRed)
        drawClickZone(clickB, title: "B", color: .systemGreen)
        drawClickZone(clickC, title: "C", color: .systemBlue)
        drawScrollPane()
        drawDragPad()
        drawTypePad()
        drawLegend()
    }

    private func drawHeader() {
        let title = "PHYSICAL / ZERO-AX PLAYFIELD" as NSString
        title.draw(
            at: NSPoint(x: 24, y: 16),
            withAttributes: [
                .font: NSFont.boldSystemFont(ofSize: 13),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
        )
        let hud = "click=\(lastClick)  scroll=\(Int(scrollOffset))  drag=(\(Int(knob.x)),\(Int(knob.y)))  type=\"\(typed)\"" as NSString
        hud.draw(
            at: NSPoint(x: 24, y: 34),
            withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
                .foregroundColor: NSColor.labelColor,
            ]
        )
    }

    private func drawClickZone(_ rect: NSRect, title: String, color: NSColor) {
        let path = NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8)
        color.withAlphaComponent(0.85).setFill()
        path.fill()
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.boldSystemFont(ofSize: 22),
            .foregroundColor: NSColor.white,
        ]
        let s = title as NSString
        let size = s.size(withAttributes: attrs)
        s.draw(
            at: NSPoint(
                x: rect.midX - size.width / 2,
                y: rect.midY - size.height / 2
            ),
            withAttributes: attrs
        )
    }

    private func drawScrollPane() {
        NSColor.controlBackgroundColor.setFill()
        NSBezierPath(roundedRect: scrollArea, xRadius: 8, yRadius: 8).fill()
        NSColor.separatorColor.setStroke()
        let border = NSBezierPath(roundedRect: scrollArea, xRadius: 8, yRadius: 8)
        border.lineWidth = 1
        border.stroke()

        ("SCROLL PANE — wheel here" as NSString).draw(
            at: NSPoint(x: scrollArea.minX + 10, y: scrollArea.minY + 8),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
        )

        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: scrollArea.insetBy(dx: 4, dy: 28)).addClip()
        let contentTop = scrollArea.minY + 32 - scrollOffset
        for i in 0..<rowCount {
            let y = contentTop + CGFloat(i) * rowH
            if y + rowH < scrollArea.minY || y > scrollArea.maxY { continue }
            let label = String(format: "Row %02d — physical scroll target", i) as NSString
            label.draw(
                at: NSPoint(x: scrollArea.minX + 12, y: y),
                withAttributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                    .foregroundColor: NSColor.labelColor,
                ]
            )
        }
        NSGraphicsContext.restoreGraphicsState()
    }

    private func drawDragPad() {
        NSColor.quaternaryLabelColor.withAlphaComponent(0.12).setFill()
        NSBezierPath(roundedRect: dragPad, xRadius: 8, yRadius: 8).fill()
        NSColor.separatorColor.setStroke()
        let border = NSBezierPath(roundedRect: dragPad, xRadius: 8, yRadius: 8)
        border.lineWidth = 1
        border.stroke()

        ("DRAG KNOB" as NSString).draw(
            at: NSPoint(x: dragPad.minX + 10, y: dragPad.minY + 8),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
        )

        let knobSize: CGFloat = 44
        let knobRect = NSRect(
            x: dragPad.minX + knob.x,
            y: dragPad.minY + 28 + knob.y,
            width: knobSize,
            height: knobSize
        )
        NSColor.systemOrange.setFill()
        NSBezierPath(roundedRect: knobRect, xRadius: 8, yRadius: 8).fill()
        ("◉" as NSString).draw(
            at: NSPoint(x: knobRect.midX - 8, y: knobRect.midY - 10),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 18),
                .foregroundColor: NSColor.white,
            ]
        )
    }

    private func drawTypePad() {
        let fill = typeFocused
            ? NSColor.controlAccentColor.withAlphaComponent(0.12)
            : NSColor.controlBackgroundColor
        fill.setFill()
        NSBezierPath(roundedRect: typePad, xRadius: 8, yRadius: 8).fill()
        (typeFocused ? NSColor.controlAccentColor : NSColor.separatorColor).setStroke()
        let border = NSBezierPath(roundedRect: typePad, xRadius: 8, yRadius: 8)
        border.lineWidth = typeFocused ? 2 : 1
        border.stroke()

        let prompt = typed.isEmpty
            ? (typeFocused ? "typing…" : "CLICK then typeText (physical) — no AX field")
            : typed
        (prompt as NSString).draw(
            at: NSPoint(x: typePad.minX + 12, y: typePad.midY - 8),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 14, weight: typed.isEmpty ? .regular : .medium),
                .foregroundColor: typed.isEmpty ? NSColor.tertiaryLabelColor : NSColor.labelColor,
            ]
        )
    }

    private func drawLegend() {
        let y = bounds.height - 28
        let text =
            "No accessibility nodes in this stage. Prefer delivery=physical. app-directed may also work via postToPid."
        (text as NSString).draw(
            at: NSPoint(x: 24, y: y),
            withAttributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NSColor.tertiaryLabelColor,
            ]
        )
    }

    // MARK: Hit testing

    private func knobFrame() -> NSRect {
        NSRect(
            x: dragPad.minX + knob.x,
            y: dragPad.minY + 28 + knob.y,
            width: 44,
            height: 44
        )
    }

    // MARK: Mouse

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let p = convert(event.locationInWindow, from: nil)

        if clickA.contains(p) {
            lastClick = "A"
            emit("click=A")
            return
        }
        if clickB.contains(p) {
            lastClick = "B"
            emit("click=B")
            return
        }
        if clickC.contains(p) {
            lastClick = "C"
            emit("click=C")
            return
        }
        if knobFrame().contains(p) {
            dragging = true
            typeFocused = false
            emit("drag start (\(Int(knob.x)),\(Int(knob.y)))")
            return
        }
        if typePad.contains(p) {
            typeFocused = true
            emit("type focused")
            return
        }
        typeFocused = false
        if scrollArea.contains(p) {
            emit("scroll pane focused (use wheel)")
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragging else { return }
        let p = convert(event.locationInWindow, from: nil)
        let maxX = dragPad.width - 44 - 8
        let maxY = dragPad.height - 28 - 44 - 8
        knob.x = min(max(0, p.x - dragPad.minX - 22), maxX)
        knob.y = min(max(0, p.y - dragPad.minY - 28 - 22), maxY)
        emit(String(format: "drag=(%.0f,%.0f)", knob.x, knob.y))
    }

    override func mouseUp(with event: NSEvent) {
        if dragging {
            dragging = false
            emit(String(format: "drag end (%.0f,%.0f)", knob.x, knob.y))
        }
    }

    override func scrollWheel(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        // Accept wheel anywhere on playfield, but prefer scroll pane.
        let inPane = scrollArea.contains(p)
        let delta = event.scrollingDeltaY != 0 ? event.scrollingDeltaY : event.deltaY
        // Flipped view: positive scrollingDeltaY typically means content moves down / offset decreases in some apps;
        // we treat positive delta as "user scrolled up → show earlier rows" by decreasing offset.
        let maxOff = max(0, CGFloat(rowCount) * rowH - (scrollArea.height - 40))
        scrollOffset = min(max(0, scrollOffset - delta), maxOff)
        if inPane || true {
            emit(String(format: "scroll=%.0f", scrollOffset))
        }
    }

    // MARK: Keyboard (after click type pad)

    override func keyDown(with event: NSEvent) {
        guard typeFocused else {
            super.keyDown(with: event)
            return
        }
        if event.keyCode == 51 { // delete
            if !typed.isEmpty { typed.removeLast() }
            emit("type=\"\(typed)\"")
            return
        }
        if event.keyCode == 36 { // return
            emit("type submit \"\(typed)\"")
            return
        }
        if let chars = event.characters, !chars.isEmpty {
            for ch in chars where ch.isASCII || ch.unicodeScalars.allSatisfy({ $0.value >= 32 }) {
                if ch == "\u{7f}" || ch == "\u{08}" { continue }
                typed.append(ch)
            }
            emit("type=\"\(typed)\"")
        }
    }
}
