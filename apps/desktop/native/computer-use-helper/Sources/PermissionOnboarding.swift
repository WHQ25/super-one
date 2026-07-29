/**
 * Permission onboarding UX modeled on Open Computer Use:
 * - Window with app identity
 * - Draggable app tile (pasteboard = .app file URL) for System Settings drop targets
 * - Allow opens the matching Privacy pane in System Settings (no system permission API dialogs)
 * - User grants by toggling the app or dragging the app tile into the list (OCU-style)
 * - Poll until granted; Screen Recording needs relaunch after toggle
 */

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@MainActor
enum PermissionOnboarding {
    private static var windowController: PermissionWindowController?

    /// Present the onboarding UI. No-op if both permissions already granted.
    static func present(onComplete: (() -> Void)? = nil) {
        if axTrusted() && screenRecordingTrusted() {
            onComplete?()
            return
        }

        NSApp.setActivationPolicy(.regular)
        let controller = PermissionWindowController(onComplete: {
            NSApp.setActivationPolicy(.accessory)
            windowController = nil
            onComplete?()
        })
        windowController = controller
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

// MARK: - Window

@MainActor
final class PermissionWindowController: NSWindowController {
    private let content: PermissionContentView
    private let onComplete: () -> Void
    private var pollTimer: Timer?

    init(onComplete: @escaping () -> Void) {
        self.onComplete = onComplete
        self.content = PermissionContentView()

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 420),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "SuperOne Computer Use"
        window.title = name
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.center()

        super.init(window: window)
        window.contentView = content
        content.onAllowAccessibility = { [weak self] in
            self?.openPrivacyPane(kind: .accessibility)
            self?.content.markRequested(kind: .accessibility)
        }
        content.onAllowScreen = { [weak self] in
            self?.openPrivacyPane(kind: .screen)
            self?.content.markRequested(kind: .screen)
        }
        content.onRelaunch = { [weak self] in
            self?.relaunchHelper()
        }
        content.onDone = { [weak self] in
            self?.finish()
        }
        content.refresh(ax: axTrusted(), screen: screenRecordingTrusted())
        startPolling()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    deinit {
        pollTimer?.invalidate()
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
        if let pollTimer {
            RunLoop.main.add(pollTimer, forMode: .common)
        }
    }

    private func tick() {
        let ax = axTrusted()
        let screen = screenRecordingTrusted()
        content.refresh(ax: ax, screen: screen)
        if ax && screen {
            pollTimer?.invalidate()
            pollTimer = nil
            // Brief delay so user sees both green, then close.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                self?.finish()
            }
        }
    }

    /// Open the Privacy pane only — no AX/CG "request access" APIs.
    /// Those APIs add a system permission sheet on top of Settings and feel like double prompts.
    /// Grant path: toggle the app in the list, or drag the onboarding tile into the list.
    private func openPrivacyPane(kind: PermissionContentView.Kind) {
        let candidates: [String]
        switch kind {
        case .accessibility:
            candidates = [
                // Ventura+ System Settings first
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ]
        case .screen:
            candidates = [
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            ]
        }
        for s in candidates {
            if let url = URL(string: s), NSWorkspace.shared.open(url) {
                return
            }
        }
    }

    private func relaunchHelper() {
        let appURL = Bundle.main.bundleURL
        let args = Array(CommandLine.arguments.dropFirst())
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.createsNewApplicationInstance = true
        configuration.arguments = args
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { _, _ in }
        // Exit current process so Screen Recording grant attaches to the new instance.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            exit(0)
        }
    }

    private func finish() {
        pollTimer?.invalidate()
        pollTimer = nil
        window?.close()
        onComplete()
    }
}

// MARK: - Content

@MainActor
final class PermissionContentView: NSView {
    enum Kind { case accessibility, screen }

    var onAllowAccessibility: (() -> Void)?
    var onAllowScreen: (() -> Void)?
    var onRelaunch: (() -> Void)?
    var onDone: (() -> Void)?

    private let titleLabel = NSTextField(labelWithString: "")
    private let subtitleLabel = NSTextField(wrappingLabelWithString: "")
    private let dragHint = NSTextField(wrappingLabelWithString: "")
    private let tile = DraggableAppTileView(frame: .zero)
    private let axRow = PermissionRowView(
        title: "Accessibility",
        subtitle: "Click and type in other apps",
        symbol: "hand.raised.fill"
    )
    private let screenRow = PermissionRowView(
        title: "Screen Recording",
        subtitle: "Screenshots so the agent can see where to click",
        symbol: "camera.viewfinder"
    )
    private let relaunchButton = NSButton(title: "Relaunch helper to apply Screen Recording", target: nil, action: nil)
    private var screenRequestedAt: Date?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "SuperOne Computer Use"

        titleLabel.stringValue = "Enable \(name)"
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.alignment = .center

        subtitleLabel.stringValue =
            "\(name) needs these permissions to control apps on your Mac.\nThey are only used when you run Computer Use tasks."
        subtitleLabel.font = .systemFont(ofSize: 13)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.alignment = .center
        subtitleLabel.maximumNumberOfLines = 3

        dragHint.stringValue =
            "Allow opens System Settings. If the app is not in the list, drag the icon below onto the privacy list."
        dragHint.font = .systemFont(ofSize: 12, weight: .medium)
        dragHint.textColor = .secondaryLabelColor
        dragHint.alignment = .center
        dragHint.maximumNumberOfLines = 3

        tile.translatesAutoresizingMaskIntoConstraints = false

        relaunchButton.bezelStyle = .rounded
        relaunchButton.controlSize = .large
        relaunchButton.target = self
        relaunchButton.action = #selector(relaunchTapped)
        relaunchButton.isHidden = true
        relaunchButton.contentTintColor = .systemOrange

        axRow.onAllow = { [weak self] in self?.onAllowAccessibility?() }
        screenRow.onAllow = { [weak self] in self?.onAllowScreen?() }

        let stack = NSStackView(views: [
            titleLabel, subtitleLabel, tile, dragHint, axRow, screenRow, relaunchButton,
        ])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.setCustomSpacing(18, after: subtitleLabel)
        stack.setCustomSpacing(8, after: tile)
        stack.setCustomSpacing(16, after: dragHint)
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -28),
            tile.widthAnchor.constraint(equalToConstant: 280),
            tile.heightAnchor.constraint(equalToConstant: 56),
            axRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            screenRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            relaunchButton.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func markRequested(kind: Kind) {
        if kind == .screen {
            screenRequestedAt = Date()
        }
        refresh(ax: axTrusted(), screen: screenRecordingTrusted())
    }

    func refresh(ax: Bool, screen: Bool) {
        axRow.setGranted(ax)
        screenRow.setGranted(screen)

        // After user opens Screen Recording settings, show relaunch CTA if still missing.
        let showRelaunch: Bool
        if screen {
            showRelaunch = false
        } else if let t = screenRequestedAt {
            showRelaunch = Date().timeIntervalSince(t) >= 1.2
        } else {
            showRelaunch = false
        }
        relaunchButton.isHidden = !showRelaunch
    }

    @objc private func relaunchTapped() {
        onRelaunch?()
    }
}

// MARK: - Permission row

@MainActor
final class PermissionRowView: NSView {
    var onAllow: (() -> Void)?

    private let titleLabel: NSTextField
    private let subtitleLabel: NSTextField
    private let statusLabel = NSTextField(labelWithString: "")
    private let allowButton = NSButton(title: "Open Settings", target: nil, action: nil)

    init(title: String, subtitle: String, symbol: String) {
        titleLabel = NSTextField(labelWithString: title)
        subtitleLabel = NSTextField(labelWithString: subtitle)
        super.init(frame: .zero)

        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor

        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        subtitleLabel.font = .systemFont(ofSize: 12)
        subtitleLabel.textColor = .secondaryLabelColor

        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.textColor = .secondaryLabelColor

        allowButton.bezelStyle = .rounded
        allowButton.target = self
        allowButton.action = #selector(allowTapped)
        allowButton.toolTip = "Open System Settings → Privacy for this permission"

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
        icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
        icon.contentTintColor = .systemBlue
        icon.translatesAutoresizingMaskIntoConstraints = false

        let textStack = NSStackView(views: [titleLabel, subtitleLabel])
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 2

        let rightStack = NSStackView(views: [statusLabel, allowButton])
        rightStack.orientation = .horizontal
        rightStack.spacing = 10
        rightStack.alignment = .centerY

        let row = NSStackView(views: [icon, textStack, NSView(), rightStack])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false
        row.setHuggingPriority(.defaultLow, for: .horizontal)
        addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            icon.widthAnchor.constraint(equalToConstant: 28),
            icon.heightAnchor.constraint(equalToConstant: 28),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 64),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    func setGranted(_ granted: Bool) {
        if granted {
            statusLabel.stringValue = "Enabled"
            statusLabel.textColor = .systemGreen
            allowButton.isHidden = true
        } else {
            statusLabel.stringValue = ""
            allowButton.isHidden = false
        }
    }

    @objc private func allowTapped() {
        onAllow?()
    }
}

// MARK: - Draggable app tile (core OCU UX)

@MainActor
final class DraggableAppTileView: NSView, NSDraggingSource {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.backgroundColor = NSColor.white.cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor(calibratedWhite: 0.86, alpha: 1).cgColor
        toolTip = "Drag into System Settings to grant permission"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let icon = appIcon()
        let iconRect = CGRect(x: 14, y: (bounds.height - 32) / 2, width: 32, height: 32)
        icon.draw(in: iconRect)

        let title = appTitle()
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold),
            .foregroundColor: NSColor(calibratedWhite: 0.22, alpha: 1),
        ]
        let titleSize = title.size(withAttributes: attrs)
        title.draw(
            at: CGPoint(x: 56, y: (bounds.height - titleSize.height) / 2),
            withAttributes: attrs
        )
    }

    override func mouseDragged(with event: NSEvent) {
        let bundleURL = Bundle.main.bundleURL
        guard bundleURL.pathExtension == "app" else {
            NSSound.beep()
            return
        }
        let item = NSDraggingItem(pasteboardWriter: bundleURL as NSURL)
        item.setDraggingFrame(bounds, contents: snapshotImage())
        let session = beginDraggingSession(with: [item], event: event, source: self)
        session.animatesToStartingPositionsOnCancelOrFail = true
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }

    private func appIcon() -> NSImage {
        NSWorkspace.shared.icon(forFile: Bundle.main.bundleURL.path)
    }

    private func appTitle() -> String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? "SuperOne Computer Use"
    }

    private func snapshotImage() -> NSImage {
        let rep = bitmapImageRepForCachingDisplay(in: bounds)
            ?? NSBitmapImageRep(
                bitmapDataPlanes: nil,
                pixelsWide: Int(bounds.width),
                pixelsHigh: Int(bounds.height),
                bitsPerSample: 8,
                samplesPerPixel: 4,
                hasAlpha: true,
                isPlanar: false,
                colorSpaceName: .deviceRGB,
                bytesPerRow: 0,
                bitsPerPixel: 0
            )!
        cacheDisplay(in: bounds, to: rep)
        let image = NSImage(size: bounds.size)
        image.addRepresentation(rep)
        return image
    }
}
