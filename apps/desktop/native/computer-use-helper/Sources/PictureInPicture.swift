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
        let shown = try await PictureInPictureController.shared.showTarget(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            windowId: windowId
        )
        return ["ok": true, "windowId": windowId, "shown": shown]
    case "pip_update_cursor":
        // Cursor metadata is renderer-owned now and travels with the target claim.
        return ["ok": true]
    case "pip_hide":
        await PictureInPictureController.shared.hide(
            sessionId: AnyCodable.string(params, "sessionId"),
            dismissedWindowId: AnyCodable.int(params, "dismissedWindowId")
        )
        return ["ok": true]
    case "pip_restore":
        guard let windowId = AnyCodable.int(params, "windowId") else {
            throw HelperError(code: "INVALID", message: "pip_restore requires windowId")
        }
        let shown = try await PictureInPictureController.shared.restore(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            windowId: windowId
        )
        return ["ok": true, "windowId": windowId, "shown": shown]
    case "pip_resize":
        guard let windowId = AnyCodable.int(params, "windowId"),
              let width = AnyCodable.int(params, "width"),
              let height = AnyCodable.int(params, "height"),
              width > 0,
              height > 0 else {
            throw HelperError(code: "INVALID", message: "pip_resize requires positive dimensions")
        }
        let resized = try await PictureInPictureController.shared.resize(
            sessionId: AnyCodable.string(params, "sessionId") ?? "",
            windowId: windowId,
            width: width,
            height: height
        )
        return ["ok": true, "windowId": windowId, "resized": resized]
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

    private static let minimumCaptureLongEdge = 480
    private static let maximumCaptureLongEdge = 1440

    private let stateQueue = DispatchQueue(label: "dev.superone.computer-use.pip.state")
    private let captureQueue = DispatchQueue(label: "dev.superone.computer-use.pip.capture")
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private var enabled = true
    private var stream: SCStream?
    private var generation: UInt64 = 0
    private var activeSessionId = ""
    private var activeWindowId = 0
    private var dismissedWindowIds: [String: Int] = [:]
    private var availabilityCheckGeneration: UInt64?

    private func withState<T>(_ body: () -> T) -> T {
        stateQueue.sync(execute: body)
    }

    func setEnabled(_ next: Bool) async {
        let changed = withState { () -> Bool in
            guard enabled != next else { return false }
            enabled = next
            return true
        }
        if changed && !next { await hide(sessionId: nil, clearDismissal: true) }
    }

    func showTarget(sessionId: String, windowId: Int) async throws -> Bool {
        let (shouldShow, sameTarget) = withState {
            let dismissed = !sessionId.isEmpty && dismissedWindowIds[sessionId] == windowId
            if !sessionId.isEmpty,
               let dismissedWindowId = dismissedWindowIds[sessionId],
               dismissedWindowId != windowId {
                dismissedWindowIds.removeValue(forKey: sessionId)
            }
            return (
                enabled && !dismissed,
                activeSessionId == sessionId && activeWindowId == windowId && stream != nil
            )
        }
        guard shouldShow else { return false }
        if sameTarget { return true }

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
        let aspect = max(window.frame.width, 1) / max(window.frame.height, 1)
        // More than 2x the 200pt initial CSS width keeps the compact preview crisp without
        // paying to encode frames the UI cannot display.
        let longEdge = CGFloat(Self.minimumCaptureLongEdge)
        let captureWidth: Int
        let captureHeight: Int
        if aspect >= 1 {
            captureWidth = Int(longEdge)
            captureHeight = max(1, Int((longEdge / aspect).rounded()))
        } else {
            captureHeight = Int(longEdge)
            captureWidth = max(1, Int((longEdge * aspect).rounded()))
        }
        let config = Self.makeCaptureConfiguration(width: captureWidth, height: captureHeight)

        let nextStream = SCStream(filter: filter, configuration: config, delegate: self)
        try nextStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)

        let (superseded, previous) = withState { () -> (Bool, SCStream?) in
            let superseded = generation != requestGeneration || !enabled
            let previous = superseded ? nil : stream
            if !superseded {
                stream = nextStream
                activeSessionId = sessionId
                activeWindowId = windowId
                availabilityCheckGeneration = nil
            }
            return (superseded, previous)
        }
        guard !superseded else { return false }
        if let previous { try? await previous.stopCapture() }

        do {
            try await nextStream.startCapture()
        } catch {
            _ = clearIfCurrent(nextStream)
            throw error
        }
        guard withState({ generation == requestGeneration && stream === nextStream }) else {
            try? await nextStream.stopCapture()
            return false
        }
        return true
    }

    func resize(
        sessionId: String,
        windowId: Int,
        width: Int,
        height: Int
    ) async throws -> Bool {
        guard width > 0, height > 0 else { return false }
        guard let current = withState({ () -> SCStream? in
            guard activeSessionId == sessionId,
                  activeWindowId == windowId else { return nil }
            return stream
        }) else { return false }

        let size = Self.clampCaptureSize(width: width, height: height)
        try await current.updateConfiguration(
            Self.makeCaptureConfiguration(width: size.width, height: size.height)
        )
        return withState {
            stream === current && activeSessionId == sessionId && activeWindowId == windowId
        }
    }

    func restore(sessionId: String, windowId: Int) async throws -> Bool {
        withState {
            if dismissedWindowIds[sessionId] == windowId {
                dismissedWindowIds.removeValue(forKey: sessionId)
            }
        }
        return try await showTarget(sessionId: sessionId, windowId: windowId)
    }

    func hide(
        sessionId: String?,
        dismissedWindowId: Int? = nil,
        clearDismissal: Bool = false
    ) async {
        let current = withState { () -> SCStream? in
            if clearDismissal {
                if let sessionId, !sessionId.isEmpty {
                    dismissedWindowIds.removeValue(forKey: sessionId)
                } else {
                    dismissedWindowIds.removeAll()
                }
            }
            if let sessionId, !sessionId.isEmpty {
                if let dismissedWindowId {
                    dismissedWindowIds[sessionId] = dismissedWindowId
                    // Cancel a matching showTarget that is awaiting shareable content.
                    generation &+= 1
                    guard activeSessionId == sessionId,
                          activeWindowId == dismissedWindowId else { return nil }
                } else {
                    guard activeSessionId == sessionId else { return nil }
                    generation &+= 1
                }
            } else {
                generation &+= 1
            }
            let current = stream
            stream = nil
            activeSessionId = ""
            activeWindowId = 0
            availabilityCheckGeneration = nil
            return current
        }
        if let current { try? await current.stopCapture() }
    }

    func hideImmediately() {
        Task { await hide(sessionId: nil, clearDismissal: true) }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen,
              sampleBuffer.isValid else { return }
        guard let attachments = (
            CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer,
                createIfNecessary: false
            ) as? [[SCStreamFrameInfo: Any]]
        )?.first,
              let statusRawValue = attachments[.status] as? Int,
              let status = SCFrameStatus(rawValue: statusRawValue) else { return }
        if status == .stopped {
            finishUnavailableStream(stream)
            return
        }
        if status == .blank {
            checkTargetAvailability(for: stream)
            return
        }
        guard status == .complete,
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
        finishUnavailableStream(stream)
    }

    private func clearIfCurrent(_ candidate: SCStream) -> (sessionId: String, windowId: Int)? {
        withState {
            guard stream === candidate else { return nil }
            let stopped = (activeSessionId, activeWindowId)
            generation &+= 1
            stream = nil
            activeSessionId = ""
            activeWindowId = 0
            availabilityCheckGeneration = nil
            return stopped
        }
    }

    private func checkTargetAvailability(for candidate: SCStream) {
        let check = withState { () -> (generation: UInt64, windowId: Int)? in
            guard stream === candidate,
                  availabilityCheckGeneration == nil else { return nil }
            availabilityCheckGeneration = generation
            return (generation, activeWindowId)
        }
        guard let check else { return }

        Task {
            defer {
                withState {
                    if availabilityCheckGeneration == check.generation {
                        availabilityCheckGeneration = nil
                    }
                }
            }
            guard let content = try? await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            ) else { return }
            let exists = content.windows.contains { Int($0.windowID) == check.windowId }
            if !exists { finishUnavailableStream(candidate) }
        }
    }

    private func finishUnavailableStream(_ candidate: SCStream) {
        guard let stopped = clearIfCurrent(candidate) else { return }
        HelperEventBus.shared.emit("computer_use_viewfinder_stopped", [
            "sessionId": stopped.sessionId,
            "windowId": stopped.windowId,
        ])
        Task { try? await candidate.stopCapture() }
    }

    private static func makeCaptureConfiguration(
        width: Int,
        height: Int
    ) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: 8)
        config.queueDepth = 2
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.captureResolution = .best
        return config
    }

    private static func clampCaptureSize(
        width: Int,
        height: Int
    ) -> (width: Int, height: Int) {
        let rawWidth = Double(max(1, width))
        let rawHeight = Double(max(1, height))
        let longEdge = max(rawWidth, rawHeight)
        let targetLongEdge = min(
            Double(maximumCaptureLongEdge),
            max(Double(minimumCaptureLongEdge), longEdge)
        )
        let scale = targetLongEdge / longEdge
        return (
            max(1, Int((rawWidth * scale).rounded())),
            max(1, Int((rawHeight * scale).rounded()))
        )
    }
}
