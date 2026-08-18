import AppKit
import AVFoundation
import CoreMedia
import Foundation
import QuartzCore
import ScreenCaptureKit

func handlePictureInPictureCommand(
    _ method: String,
    params: [String: Any]
) async throws -> [String: Any] {
    switch method {
    case "pip_set_enabled":
        let enabled = (params["enabled"] as? Bool) ?? true
        await PictureInPictureController.shared.setEnabled(enabled)
        return ["ok": true, "enabled": enabled]
    case "pip_show_target":
        guard let windowId = AnyCodable.int(params, "windowId") else {
            throw HelperError(code: "INVALID", message: "pip_show_target requires windowId")
        }
        try await PictureInPictureController.shared.showTarget(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            windowId: windowId,
            appName: AnyCodable.string(params, "app") ?? "",
            title: AnyCodable.string(params, "title") ?? "",
            cursorX: AnyCodable.double(params, "cursorX"),
            cursorY: AnyCodable.double(params, "cursorY"),
            sourceWidth: AnyCodable.double(params, "sourceWidth")
                ?? AnyCodable.double(params, "coordinateWidth"),
            sourceHeight: AnyCodable.double(params, "sourceHeight")
                ?? AnyCodable.double(params, "coordinateHeight"),
            pulse: (params["pulse"] as? Bool) ?? false
        )
        return ["ok": true, "windowId": windowId]
    case "pip_update_cursor":
        guard let x = AnyCodable.double(params, "x"),
              let y = AnyCodable.double(params, "y"),
              let sourceWidth = AnyCodable.double(params, "sourceWidth"),
              let sourceHeight = AnyCodable.double(params, "sourceHeight") else {
            throw HelperError(
                code: "INVALID",
                message: "pip_update_cursor requires x, y, sourceWidth, sourceHeight"
            )
        }
        await PictureInPictureController.shared.updateCursor(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            x: x,
            y: y,
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight,
            pulse: (params["pulse"] as? Bool) ?? false
        )
        return ["ok": true]
    case "pip_hide":
        await PictureInPictureController.shared.hide(
            sessionId: AnyCodable.string(params, "sessionId")
        )
        return ["ok": true]
    default:
        throw HelperError(code: "UNKNOWN_METHOD", message: method)
    }
}

private let pipToolbarHeight: CGFloat = 30
private let pipInitialSize = NSSize(width: 480, height: 320)
private let pipMinimumSize = NSSize(width: 280, height: 190)

private final class PictureInPictureView: NSView {
    let videoLayer = AVSampleBufferDisplayLayer()
    var onClose: (() -> Void)?

    private let titleLabel = NSTextField(labelWithString: "Computer Use")
    private let closeButton = NSButton()
    private let cursorLayer = CAShapeLayer()
    private var cursorPoint: CGPoint?
    private var cursorSourceSize = CGSize(width: 1, height: 1)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        layer?.cornerRadius = 12
        layer?.masksToBounds = true

        videoLayer.videoGravity = .resizeAspect
        videoLayer.backgroundColor = NSColor.black.cgColor
        layer?.addSublayer(videoLayer)

        titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        titleLabel.textColor = .white
        titleLabel.lineBreakMode = .byTruncatingTail
        addSubview(titleLabel)

        closeButton.isBordered = false
        closeButton.image = NSImage(
            systemSymbolName: "xmark.circle.fill",
            accessibilityDescription: "Close preview"
        )
        closeButton.contentTintColor = NSColor.white.withAlphaComponent(0.78)
        closeButton.target = self
        closeButton.action = #selector(closePreview)
        addSubview(closeButton)

        cursorLayer.fillColor = NSColor.systemOrange.cgColor
        cursorLayer.strokeColor = NSColor.white.cgColor
        cursorLayer.lineWidth = 2
        cursorLayer.shadowColor = NSColor.black.cgColor
        cursorLayer.shadowOpacity = 0.5
        cursorLayer.shadowRadius = 3
        cursorLayer.shadowOffset = .zero
        cursorLayer.isHidden = true
        layer?.addSublayer(cursorLayer)
    }

    required init?(coder: NSCoder) {
        nil
    }

    func setTitle(_ value: String) {
        titleLabel.stringValue = value.isEmpty ? "Computer Use" : value
    }

    func updateCursor(x: Double, y: Double, sourceWidth: Double, sourceHeight: Double, pulse: Bool) {
        guard sourceWidth > 1, sourceHeight > 1 else { return }
        cursorPoint = CGPoint(x: x, y: y)
        cursorSourceSize = CGSize(width: sourceWidth, height: sourceHeight)
        cursorLayer.isHidden = false
        positionCursor()
        if pulse {
            let animation = CABasicAnimation(keyPath: "transform.scale")
            animation.fromValue = 1.7
            animation.toValue = 1
            animation.duration = 0.24
            animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
            cursorLayer.add(animation, forKey: "pulse")
        }
    }

    func hideCursor() {
        cursorPoint = nil
        cursorLayer.isHidden = true
        cursorLayer.removeAllAnimations()
    }

    override func layout() {
        super.layout()
        let contentHeight = max(1, bounds.height - pipToolbarHeight)
        videoLayer.frame = CGRect(x: 0, y: 0, width: bounds.width, height: contentHeight)
        titleLabel.frame = CGRect(
            x: 12,
            y: contentHeight + 5,
            width: max(1, bounds.width - 52),
            height: 20
        )
        closeButton.frame = CGRect(x: bounds.width - 32, y: contentHeight + 3, width: 26, height: 24)
        positionCursor()
    }

    @objc private func closePreview() {
        onClose?()
    }

    private func positionCursor() {
        guard let point = cursorPoint else { return }
        let viewport = videoLayer.frame
        let scale = min(
            viewport.width / max(cursorSourceSize.width, 1),
            viewport.height / max(cursorSourceSize.height, 1)
        )
        let rendered = CGSize(
            width: cursorSourceSize.width * scale,
            height: cursorSourceSize.height * scale
        )
        let origin = CGPoint(
            x: viewport.minX + (viewport.width - rendered.width) / 2,
            y: viewport.minY + (viewport.height - rendered.height) / 2
        )
        let mapped = CGPoint(
            x: origin.x + point.x * scale,
            y: origin.y + rendered.height - point.y * scale
        )
        let diameter: CGFloat = 14
        cursorLayer.path = CGPath(
            ellipseIn: CGRect(x: 0, y: 0, width: diameter, height: diameter),
            transform: nil
        )
        cursorLayer.frame = CGRect(
            x: mapped.x - diameter / 2,
            y: mapped.y - diameter / 2,
            width: diameter,
            height: diameter
        )
    }
}

private final class PictureInPicturePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Native, read-only live preview for the latest Computer Use target.
///
/// Frames stay inside the signed helper process: the host sends only window and
/// cursor metadata, avoiding PNG encoding and JSON/base64 IPC for every frame.
final class PictureInPictureController: NSObject, SCStreamOutput, SCStreamDelegate {
    static let shared = PictureInPictureController()

    private let captureQueue = DispatchQueue(label: "dev.superone.computer-use.pip.capture")
    private let stateLock = NSLock()
    private var enabled = true
    private var stream: SCStream?
    private var panel: PictureInPicturePanel?
    private var previewView: PictureInPictureView?
    private var activeSessionId = ""
    private var activeWindowId = 0
    private var dismissedTarget: String?
    private var generation: UInt64 = 0

    private override init() {
        super.init()
    }

    private func withState<T>(_ body: () -> T) -> T {
        stateLock.lock()
        defer { stateLock.unlock() }
        return body()
    }

    func setEnabled(_ value: Bool) async {
        withState {
            enabled = value
            if value { dismissedTarget = nil }
        }
        if !value {
            await hide(sessionId: nil)
        }
    }

    func showTarget(
        sessionId: String,
        windowId: Int,
        appName: String,
        title: String,
        cursorX: Double?,
        cursorY: Double?,
        sourceWidth: Double?,
        sourceHeight: Double?,
        pulse: Bool
    ) async throws {
        guard windowId > 0 else { return }
        let targetKey = "\(sessionId):\(windowId)"

        let (shouldShow, sameTarget) = withState {
            (
                enabled && dismissedTarget != targetKey,
                activeSessionId == sessionId && activeWindowId == windowId && stream != nil
            )
        }
        guard shouldShow else { return }
        let displayTitle = title.isEmpty ? appName : "\(appName) — \(title)"
        if sameTarget {
            await updatePanel(
                title: displayTitle,
                cursorX: cursorX,
                cursorY: cursorY,
                sourceWidth: sourceWidth,
                sourceHeight: sourceHeight,
                pulse: pulse,
                clearCursor: false
            )
            return
        }

        let requestGeneration = withState {
            generation &+= 1
            return generation
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { Int($0.windowID) == windowId }), window.isOnScreen else {
            throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) is unavailable for picture in picture")
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let aspect = max(window.frame.width, 1) / max(window.frame.height, 1)
        let longEdge: CGFloat = 640
        if aspect >= 1 {
            config.width = Int(longEdge)
            config.height = max(1, Int((longEdge / aspect).rounded()))
        } else {
            config.height = Int(longEdge)
            config.width = max(1, Int((longEdge * aspect).rounded()))
        }
        config.minimumFrameInterval = CMTime(value: 1, timescale: 12)
        config.queueDepth = 3
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.captureResolution = .best

        let nextStream = SCStream(filter: filter, configuration: config, delegate: self)
        try nextStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)

        let (superseded, previous) = withState { () -> (Bool, SCStream?) in
            let superseded = generation != requestGeneration || !enabled
            let previous = superseded ? nil : stream
            if !superseded {
                stream = nextStream
                activeSessionId = sessionId
                activeWindowId = windowId
                if dismissedTarget != targetKey { dismissedTarget = nil }
            }
            return (superseded, previous)
        }
        guard !superseded else { return }

        if let previous {
            try? await previous.stopCapture()
        }
        await flushVideoLayer()
        await updatePanel(
            title: displayTitle,
            cursorX: cursorX,
            cursorY: cursorY,
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight,
            pulse: pulse,
            clearCursor: cursorX == nil || cursorY == nil
        )

        guard withState({ generation == requestGeneration && stream === nextStream }) else {
            await hidePanelIfInactive()
            return
        }
        do {
            try await nextStream.startCapture()
        } catch {
            let removed = withState { () -> Bool in
                guard stream === nextStream else { return false }
                generation &+= 1
                stream = nil
                activeSessionId = ""
                activeWindowId = 0
                return true
            }
            if removed { await hidePanelIfInactive() }
            throw error
        }
        guard withState({ generation == requestGeneration && stream === nextStream }) else {
            try? await nextStream.stopCapture()
            await hidePanelIfInactive()
            return
        }
    }

    func updateCursor(
        sessionId: String,
        x: Double,
        y: Double,
        sourceWidth: Double,
        sourceHeight: Double,
        pulse: Bool
    ) async {
        let matches = withState { activeSessionId == sessionId }
        guard matches else { return }
        await updatePanel(
            title: nil,
            cursorX: x,
            cursorY: y,
            sourceWidth: sourceWidth,
            sourceHeight: sourceHeight,
            pulse: pulse,
            clearCursor: false
        )
    }

    func hide(sessionId: String?) async {
        let (shouldHide, current) = withState { () -> (Bool, SCStream?) in
            if let sessionId, !sessionId.isEmpty, activeSessionId != sessionId {
                return (false, nil)
            }
            generation &+= 1
            let current = stream
            stream = nil
            activeSessionId = ""
            activeWindowId = 0
            return (true, current)
        }
        guard shouldHide else { return }

        if let current {
            try? await current.stopCapture()
        }
        await MainActor.run {
            self.previewView?.videoLayer.flushAndRemoveImage()
            self.panel?.orderOut(nil)
        }
    }

    func hideImmediately() {
        Task { await hide(sessionId: nil) }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        let isCurrent = withState { self.stream === stream }
        guard isCurrent else { return }

        DispatchQueue.main.async { [weak self] in
            guard let layer = self?.previewView?.videoLayer else { return }
            if layer.status == .failed {
                layer.flush()
            }
            layer.enqueue(sampleBuffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        let isCurrent = withState {
            let isCurrent = self.stream === stream
            if isCurrent {
                self.stream = nil
                activeSessionId = ""
                activeWindowId = 0
            }
            return isCurrent
        }
        guard isCurrent else { return }
        DispatchQueue.main.async { [weak self] in
            self?.previewView?.videoLayer.flushAndRemoveImage()
            self?.panel?.orderOut(nil)
        }
    }

    private func updatePanel(
        title: String?,
        cursorX: Double?,
        cursorY: Double?,
        sourceWidth: Double?,
        sourceHeight: Double?,
        pulse: Bool,
        clearCursor: Bool
    ) async {
        await MainActor.run {
            let view = self.ensurePanel()
            if let title { view.setTitle(title) }
            if clearCursor { view.hideCursor() }
            if let cursorX, let cursorY, let sourceWidth, let sourceHeight {
                view.updateCursor(
                    x: cursorX,
                    y: cursorY,
                    sourceWidth: sourceWidth,
                    sourceHeight: sourceHeight,
                    pulse: pulse
                )
            }
            self.panel?.orderFrontRegardless()
        }
    }

    private func flushVideoLayer() async {
        await MainActor.run {
            self.previewView?.videoLayer.flushAndRemoveImage()
        }
    }

    private func hidePanelIfInactive() async {
        guard withState({ stream == nil }) else { return }
        await MainActor.run {
            self.previewView?.videoLayer.flushAndRemoveImage()
            self.panel?.orderOut(nil)
        }
    }

    @MainActor
    private func ensurePanel() -> PictureInPictureView {
        if let previewView { return previewView }

        let screen = NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = CGRect(
            x: visible.maxX - pipInitialSize.width - 24,
            y: visible.minY + 24,
            width: pipInitialSize.width,
            height: pipInitialSize.height
        )
        let view = PictureInPictureView(frame: CGRect(origin: .zero, size: pipInitialSize))
        let panel = PictureInPicturePanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.minSize = pipMinimumSize
        panel.contentView = view
        panel.isExcludedFromWindowsMenu = true
        panel.animationBehavior = .utilityWindow
        view.onClose = { [weak self] in
            guard let self else { return }
            self.withState {
                self.dismissedTarget = "\(self.activeSessionId):\(self.activeWindowId)"
            }
            self.hideImmediately()
        }

        self.panel = panel
        previewView = view
        return view
    }
}
