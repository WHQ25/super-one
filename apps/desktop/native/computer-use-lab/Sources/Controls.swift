import AppKit

enum LabAX {
    static let app = "cu.lab"
    static let scenarioList = "cu.lab.scenarioList"
    static let stage = "cu.lab.stage"
    static let status = "cu.lab.status"
    static let reset = "cu.lab.reset"
    static let scenarioPrefix = "cu.lab.scenario."
}

extension NSView {
    /// Tag a view for Computer Use without clobbering native AX roles/actions.
    @discardableResult
    func labID(_ id: String, label: String? = nil) -> Self {
        setAccessibilityIdentifier(id)
        if let label {
            let existing = accessibilityLabel() ?? ""
            if existing.isEmpty {
                setAccessibilityLabel(label)
            }
        }
        return self
    }
}

enum LabUI {
    static func label(_ text: String, size: CGFloat = 13, weight: NSFont.Weight = .regular) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .systemFont(ofSize: size, weight: weight)
        f.lineBreakMode = .byWordWrapping
        f.maximumNumberOfLines = 0
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        f.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return f
    }

    static func mono(_ text: String) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        f.textColor = .secondaryLabelColor
        f.lineBreakMode = .byTruncatingTail
        return f
    }

    static func button(_ title: String, id: String, target: AnyObject?, action: Selector) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.bezelStyle = .rounded
        b.setButtonType(.momentaryLight)
        b.setAccessibilityIdentifier(id)
        b.setContentHuggingPriority(.required, for: .horizontal)
        b.setContentHuggingPriority(.required, for: .vertical)
        return b
    }

    static func field(placeholder: String, id: String) -> NSTextField {
        let f = NSTextField(string: "")
        f.placeholderString = placeholder
        f.isEditable = true
        f.isSelectable = true
        f.isBezeled = true
        f.bezelStyle = .squareBezel
        f.font = .systemFont(ofSize: 14)
        f.setAccessibilityIdentifier(id)
        f.setContentHuggingPriority(.defaultLow, for: .horizontal)
        f.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return f
    }

    /// Vertical stack that stretches children to full width (`.width` alignment).
    static func vstack(_ views: [NSView], spacing: CGFloat = 12) -> NSStackView {
        let s = NSStackView(views: views)
        s.orientation = .vertical
        s.alignment = .width
        s.spacing = spacing
        s.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        s.translatesAutoresizingMaskIntoConstraints = false
        s.setHuggingPriority(.defaultHigh, for: .vertical)
        s.setContentHuggingPriority(.defaultHigh, for: .vertical)
        return s
    }

    static func hstack(_ views: [NSView], spacing: CGFloat = 8) -> NSStackView {
        let s = NSStackView(views: views)
        s.orientation = .horizontal
        s.alignment = .centerY
        s.spacing = spacing
        s.translatesAutoresizingMaskIntoConstraints = false
        s.setHuggingPriority(.defaultHigh, for: .vertical)
        return s
    }

    /// Card without NSBox contentView (which collapses under Auto Layout).
    static func card(_ title: String, body: NSView) -> NSView {
        let titleLabel = label(title, size: 12, weight: .semibold)
        titleLabel.textColor = .secondaryLabelColor

        let stack = vstack([titleLabel, body], spacing: 10)

        let container = NSView()
        container.wantsLayer = true
        container.layer?.cornerRadius = 10
        container.layer?.borderWidth = 1
        container.layer?.borderColor = NSColor.separatorColor.cgColor
        container.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        container.translatesAutoresizingMaskIntoConstraints = false

        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
        ])
        return container
    }

    /// Pin content into a plain host (sheet/popover content views).
    static func pinned(_ view: NSView, in host: NSView, insets: CGFloat = 16) {
        view.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: insets),
            view.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -insets),
            view.topAnchor.constraint(equalTo: host.topAnchor, constant: insets),
            view.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -insets),
        ])
    }

    /// Standard scenario root: scrollable stage with stable AX id.
    static func stage(_ id: String, _ content: NSView) -> NSView {
        let root = scrollStage(content)
        root.labID(id)
        return root
    }

    /// Build a scrollable stage host that scenarios return as their root.
    static func scrollStage(_ content: NSView) -> NSView {
        let outer = NSView()
        outer.translatesAutoresizingMaskIntoConstraints = false

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.scrollerStyle = .overlay
        scroll.contentView = FlippedClipView()

        // Document is a plain flipped view; content is forced to scroll-view width
        // so vertical stacks left-align instead of trailing-collapsing.
        let doc = FlippedDocView()
        content.translatesAutoresizingMaskIntoConstraints = false
        content.setContentHuggingPriority(.defaultLow, for: .horizontal)
        content.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        doc.translatesAutoresizingMaskIntoConstraints = false
        doc.addSubview(content)
        scroll.documentView = doc
        outer.addSubview(scroll)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: outer.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: outer.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: outer.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: outer.bottomAnchor),

            content.leadingAnchor.constraint(equalTo: doc.leadingAnchor, constant: 16),
            content.topAnchor.constraint(equalTo: doc.topAnchor, constant: 16),
            content.bottomAnchor.constraint(equalTo: doc.bottomAnchor, constant: -16),
            content.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor, constant: -32),
            doc.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
        ])
        return outer
    }
}

final class FlippedClipView: NSClipView {
    override var isFlipped: Bool { true }
}

final class FlippedDocView: NSView {
    override var isFlipped: Bool { true }
}
