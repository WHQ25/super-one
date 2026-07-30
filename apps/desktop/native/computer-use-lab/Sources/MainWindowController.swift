import AppKit

final class MainWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate {
    private let scenarios: [LabScenario]
    private var selected = 0
    private var current: LabScenario?

    private let split = NSSplitView()
    private let table = NSTableView()
    private let stageHost = NSView()
    private let statusField = NSTextField(labelWithString: "Ready")
    private let detailField = NSTextField(labelWithString: "")
    private let toolsField = NSTextField(labelWithString: "")
    private var stageContent: NSView?

    init(scenarios: [LabScenario]) {
        self.scenarios = scenarios
        let window = NSWindow(
            contentRect: NSRect(x: 80, y: 80, width: 1000, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "SuperOne CU Lab"
        window.minSize = NSSize(width: 860, height: 560)
        window.setFrameAutosaveName("SuperOneCULabMain")
        super.init(window: window)
        window.contentView = buildRoot()
        selectScenario(at: 0)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    private func buildRoot() -> NSView {
        let root = NSView()
        root.labID(LabAX.app)

        // Sidebar
        let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("scenario"))
        col.title = "Scenarios"
        col.width = 220
        table.addTableColumn(col)
        table.headerView = nil
        table.style = .sourceList
        table.rowHeight = 36
        table.delegate = self
        table.dataSource = self
        table.allowsEmptySelection = false
        table.labID(LabAX.scenarioList, label: "Scenarios")
        table.target = self
        table.action = #selector(tableClicked)
        table.doubleAction = #selector(tableClicked)

        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        // Header chrome
        statusField.font = .systemFont(ofSize: 13, weight: .semibold)
        statusField.lineBreakMode = .byTruncatingTail
        statusField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusField.labID(LabAX.status, label: "Ready")
        statusField.setAccessibilityValue("Ready")

        detailField.font = .systemFont(ofSize: 12)
        detailField.textColor = .secondaryLabelColor
        detailField.maximumNumberOfLines = 2
        detailField.lineBreakMode = .byWordWrapping
        detailField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        toolsField.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        toolsField.textColor = .tertiaryLabelColor
        toolsField.lineBreakMode = .byTruncatingTail

        let reset = LabUI.button("Reset Scenario", id: LabAX.reset, target: self, action: #selector(resetScenario))

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let titleRow = LabUI.hstack([statusField, spacer, reset], spacing: 10)
        let header = LabUI.vstack([titleRow, detailField, toolsField], spacing: 4)
        header.alignment = .leading
        header.translatesAutoresizingMaskIntoConstraints = false

        // Stage panel
        stageHost.labID(LabAX.stage, label: "Stage")
        stageHost.wantsLayer = true
        stageHost.layer?.backgroundColor = NSColor.textBackgroundColor.cgColor
        stageHost.layer?.cornerRadius = 10
        stageHost.layer?.borderWidth = 1
        stageHost.layer?.borderColor = NSColor.separatorColor.cgColor
        stageHost.translatesAutoresizingMaskIntoConstraints = false
        stageHost.setContentHuggingPriority(.defaultLow, for: .vertical)
        stageHost.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

        let right = NSView()
        right.translatesAutoresizingMaskIntoConstraints = false
        right.addSubview(header)
        right.addSubview(stageHost)
        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: right.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: right.trailingAnchor),
            header.topAnchor.constraint(equalTo: right.topAnchor),

            stageHost.leadingAnchor.constraint(equalTo: right.leadingAnchor),
            stageHost.trailingAnchor.constraint(equalTo: right.trailingAnchor),
            stageHost.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 10),
            stageHost.bottomAnchor.constraint(equalTo: right.bottomAnchor),
            stageHost.heightAnchor.constraint(greaterThanOrEqualToConstant: 380),
        ])

        split.isVertical = true
        split.dividerStyle = .thin
        split.arrangesAllSubviews = true
        split.addArrangedSubview(scroll)
        split.addArrangedSubview(right)
        split.setHoldingPriority(NSLayoutConstraint.Priority(rawValue: 260), forSubviewAt: 0)
        split.translatesAutoresizingMaskIntoConstraints = false

        root.addSubview(split)
        NSLayoutConstraint.activate([
            split.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
            split.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
            split.topAnchor.constraint(equalTo: root.topAnchor, constant: 10),
            split.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10),
            scroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 200),
            scroll.widthAnchor.constraint(lessThanOrEqualToConstant: 280),
        ])

        DispatchQueue.main.async { [weak self] in
            self?.split.setPosition(230, ofDividerAt: 0)
        }
        return root
    }

    // MARK: - Table

    func numberOfRows(in tableView: NSTableView) -> Int { scenarios.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let s = scenarios[row]
        let cell = NSTableCellView()
        let text = NSTextField(labelWithString: "\(s.id)  \(s.title)")
        text.font = .systemFont(ofSize: 13)
        text.lineBreakMode = .byTruncatingTail
        text.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(text)
        NSLayoutConstraint.activate([
            text.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 8),
            text.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -8),
            text.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        text.labID("\(LabAX.scenarioPrefix)\(s.id)", label: "\(s.id) \(s.title)")
        return cell
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { true }

    @objc private func tableClicked() {
        let row = table.clickedRow >= 0 ? table.clickedRow : table.selectedRow
        guard row >= 0, row < scenarios.count else { return }
        selectScenario(at: row)
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = table.selectedRow
        guard row >= 0, row < scenarios.count else { return }
        if row != selected {
            selectScenario(at: row)
        }
    }

    // MARK: - Scenario host

    private func selectScenario(at index: Int) {
        guard index >= 0, index < scenarios.count else { return }
        current?.closeExtras()
        selected = index
        if table.selectedRow != index {
            table.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        }

        let scenario = scenarios[index]
        current = scenario
        detailField.stringValue = scenario.summary
        toolsField.stringValue =
            "tools: \(scenario.tools.joined(separator: ", "))  ·  delivery: \(scenario.deliveries.joined(separator: ", "))"

        stageContent?.removeFromSuperview()
        let content = scenario.makeStage { [weak self] text in
            self?.setStatus(text)
        }
        // Prefer scrollable stage wrapper so tall scenarios fit.
        let wrapped: NSView
        if content is NSScrollView {
            wrapped = content
        } else {
            // Scenarios that already use LabUI.scrollStage return a ready host;
            // others get automatic scroll wrap for safety.
            wrapped = content
        }
        wrapped.translatesAutoresizingMaskIntoConstraints = false
        stageHost.addSubview(wrapped)
        NSLayoutConstraint.activate([
            wrapped.leadingAnchor.constraint(equalTo: stageHost.leadingAnchor),
            wrapped.trailingAnchor.constraint(equalTo: stageHost.trailingAnchor),
            wrapped.topAnchor.constraint(equalTo: stageHost.topAnchor),
            wrapped.bottomAnchor.constraint(equalTo: stageHost.bottomAnchor),
        ])
        stageContent = wrapped
        setStatus("\(scenario.id) \(scenario.title) ready")
    }

    @objc private func resetScenario() {
        current?.reset()
        setStatus("\(current?.id ?? "") reset")
    }

    private func setStatus(_ text: String) {
        statusField.stringValue = text
        statusField.setAccessibilityLabel(text)
        statusField.setAccessibilityValue(text)
    }
}
