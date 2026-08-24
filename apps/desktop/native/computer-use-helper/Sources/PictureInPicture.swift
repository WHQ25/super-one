import CoreImage
import CoreMedia
import Foundation
import ImageIO
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
            windowId: windowId
        )
        return ["ok": true, "windowId": windowId]
    case "pip_update_cursor":
        // Cursor metadata is renderer-owned now and travels with the target claim.
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

/// Native frame source for the renderer-owned Computer Use picture-in-picture.
///
/// ScreenCaptureKit must stay in this signed helper because this process owns the
/// user's macOS Screen Recording grant. The old NSPanel is intentionally gone: JPEG
/// frames are emitted over the helper's existing reverse event channel and React
/// positions them inside the session that owns the turn.
final class PictureInPictureController: NSObject, SCStreamOutput, SCStreamDelegate {
    static let shared = PictureInPictureController()

    private let stateQueue = DispatchQueue(label: "dev.superone.computer-use.pip.state")
    private let captureQueue = DispatchQueue(label: "dev.superone.computer-use.pip.capture")
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private var enabled = true
    private var stream: SCStream?
    private var generation: UInt64 = 0
    private var activeSessionId = ""
    private var activeWindowId = 0

    private func withState<T>(_ body: () -> T) -> T {
        stateQueue.sync(execute: body)
    }

    func setEnabled(_ next: Bool) async {
        let changed = withState { () -> Bool in
            guard enabled != next else { return false }
            enabled = next
            return true
        }
        if changed && !next { await hide(sessionId: nil) }
    }

    func showTarget(sessionId: String, windowId: Int) async throws {
        let (shouldShow, sameTarget) = withState {
            (
                enabled,
                activeSessionId == sessionId && activeWindowId == windowId && stream != nil
            )
        }
        guard shouldShow else { return }
        if sameTarget { return }

        let requestGeneration = withState {
            generation &+= 1
            return generation
        }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let window = content.windows.first(where: { Int($0.windowID) == windowId }),
              window.isOnScreen else {
            throw HelperError(
                code: "WINDOW_UNAVAILABLE",
                message: "Window \(windowId) is unavailable for picture in picture"
            )
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let aspect = max(window.frame.width, 1) / max(window.frame.height, 1)
        // More than 2x the 180pt initial CSS width keeps the compact preview crisp without
        // paying to encode frames the UI cannot display.
        let longEdge: CGFloat = 480
        if aspect >= 1 {
            config.width = Int(longEdge)
            config.height = max(1, Int((longEdge / aspect).rounded()))
        } else {
            config.height = Int(longEdge)
            config.width = max(1, Int((longEdge * aspect).rounded()))
        }
        config.minimumFrameInterval = CMTime(value: 1, timescale: 8)
        config.queueDepth = 2
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
            }
            return (superseded, previous)
        }
        guard !superseded else { return }
        if let previous { try? await previous.stopCapture() }

        do {
            try await nextStream.startCapture()
        } catch {
            _ = clearIfCurrent(nextStream)
            throw error
        }
        guard withState({ generation == requestGeneration && stream === nextStream }) else {
            try? await nextStream.stopCapture()
            return
        }
    }

    func hide(sessionId: String?) async {
        let current = withState { () -> SCStream? in
            if let sessionId, !sessionId.isEmpty, activeSessionId != sessionId { return nil }
            generation &+= 1
            let current = stream
            stream = nil
            activeSessionId = ""
            activeWindowId = 0
            return current
        }
        if let current { try? await current.stopCapture() }
    }

    func hideImmediately() {
        Task { await hide(sessionId: nil) }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen,
              sampleBuffer.isValid,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let target = withState { () -> (String, Int)? in
            guard self.stream === stream else { return nil }
            return (activeSessionId, activeWindowId)
        }
        guard let (sessionId, windowId) = target else { return }

        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let jpeg = imageContext.jpegRepresentation(
            of: image,
            colorSpace: colorSpace,
            options: [
                CIImageRepresentationOption(
                    rawValue: kCGImageDestinationLossyCompressionQuality as String
                ): 0.72,
            ]
        ) else { return }
        HelperEventBus.shared.emit("computer_use_viewfinder_frame", [
            "sessionId": sessionId,
            "windowId": windowId,
            "width": CVPixelBufferGetWidth(pixelBuffer),
            "height": CVPixelBufferGetHeight(pixelBuffer),
            "data": jpeg.base64EncodedString(),
        ])
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        guard let stopped = clearIfCurrent(stream) else { return }
        HelperEventBus.shared.emit("computer_use_viewfinder_stopped", [
            "sessionId": stopped.sessionId,
            "windowId": stopped.windowId,
        ])
    }

    private func clearIfCurrent(_ candidate: SCStream) -> (sessionId: String, windowId: Int)? {
        withState {
            guard stream === candidate else { return nil }
            let stopped = (activeSessionId, activeWindowId)
            generation &+= 1
            stream = nil
            activeSessionId = ""
            activeWindowId = 0
            return stopped
        }
    }
}
