import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

func handleActionRecordingCommand(
    _ method: String,
    params: [String: Any]
) async throws -> [String: Any] {
    switch method {
    case "record_start":
        guard let windowId = AnyCodable.int(params, "windowId"),
              let outputPath = AnyCodable.string(params, "outputPath") else {
            throw HelperError(code: "INVALID", message: "record_start requires windowId and outputPath")
        }
        try await ActionRecordingController.shared.start(
            windowId: windowId,
            outputPath: outputPath,
            maxWidth: AnyCodable.int(params, "maxWidth") ?? 1440
        )
        return ["ok": true]
    case "record_stop":
        return try await ActionRecordingController.shared.stop()
    default:
        throw HelperError(code: "UNKNOWN_METHOD", message: method)
    }
}

/// A short, window-scoped MP4 used as human-verifiable evidence for one act call.
final class ActionRecordingController: NSObject, SCStreamOutput, SCStreamDelegate {
    static let shared = ActionRecordingController()

    private let captureQueue = DispatchQueue(label: "dev.superone.computer-use.action-recording")
    private let lock = NSLock()
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var outputPath = ""
    private var width = 0
    private var height = 0
    private var firstTimestamp: CMTime?
    private var lastTimestamp: CMTime?
    private var failure: Error?

    private override init() {
        super.init()
    }

    private func withState<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func start(windowId: Int, outputPath: String, maxWidth: Int) async throws {
        guard screenRecordingTrusted() else {
            throw HelperError(code: "SCREEN_MISSING", message: "Screen Recording is not granted for Computer Use helper")
        }
        let active = withState { stream != nil }
        if active {
            throw HelperError(code: "RECORDING_ACTIVE", message: "Another Computer Use action is already recording")
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: { Int($0.windowID) == windowId }), window.isOnScreen else {
            throw HelperError(code: "WINDOW_UNAVAILABLE", message: "Window \(windowId) is unavailable for recording")
        }
        let aspect = max(window.frame.width, 1) / max(window.frame.height, 1)
        let cappedWidth = min(max(CGFloat(maxWidth), 320), max(window.frame.width * 2, 2))
        let videoWidth = max(2, Int(cappedWidth.rounded()) / 2 * 2)
        let videoHeight = max(2, Int((CGFloat(videoWidth) / aspect).rounded()) / 2 * 2)

        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: outputPath).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? FileManager.default.removeItem(atPath: outputPath)
        let assetWriter = try AVAssetWriter(outputURL: URL(fileURLWithPath: outputPath), fileType: .mp4)
        let writerInput = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: videoWidth,
                AVVideoHeightKey: videoHeight,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: 2_000_000,
                    AVVideoExpectedSourceFrameRateKey: 12,
                ],
            ]
        )
        writerInput.expectsMediaDataInRealTime = true
        let pixelAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: writerInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: videoWidth,
                kCVPixelBufferHeightKey as String: videoHeight,
            ]
        )
        guard assetWriter.canAdd(writerInput) else {
            throw HelperError(code: "ENCODE", message: "Cannot configure MP4 action recorder")
        }
        assetWriter.add(writerInput)

        let config = SCStreamConfiguration()
        config.width = videoWidth
        config.height = videoHeight
        config.minimumFrameInterval = CMTime(value: 1, timescale: 12)
        config.queueDepth = 4
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.captureResolution = .best
        let nextStream = SCStream(
            filter: SCContentFilter(desktopIndependentWindow: window),
            configuration: config,
            delegate: self
        )
        try nextStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: captureQueue)

        withState {
            self.stream = nextStream
            self.writer = assetWriter
            self.input = writerInput
            self.adaptor = pixelAdaptor
            self.outputPath = outputPath
            self.width = videoWidth
            self.height = videoHeight
            self.firstTimestamp = nil
            self.lastTimestamp = nil
            self.failure = nil
        }
        do {
            try await nextStream.startCapture()
        } catch {
            withState { clearState() }
            try? FileManager.default.removeItem(atPath: outputPath)
            throw error
        }
    }

    func stop() async throws -> [String: Any] {
        let snapshot = withState { () -> (SCStream, AVAssetWriter, AVAssetWriterInput)? in
            guard let stream, let writer, let input else { return nil }
            return (stream, writer, input)
        }
        guard let snapshot else {
            throw HelperError(code: "NO_RECORDING", message: "No Computer Use action recording is active")
        }
        try? await snapshot.0.stopCapture()
        captureQueue.sync {}

        let final = withState { () -> (AVAssetWriter, AVAssetWriterInput, String, Int, Int, CMTime?, CMTime?, Error?) in
            (writer!, input!, outputPath, width, height, firstTimestamp, lastTimestamp, failure)
        }
        var completed = false
        defer {
            withState { clearState() }
            if !completed { try? FileManager.default.removeItem(atPath: final.2) }
        }
        if let failure = final.7 {
            throw failure
        }
        guard final.0.status == .writing, let first = final.5 else {
            let message = final.0.error?.localizedDescription ?? "Action recording produced no frames"
            throw HelperError(code: "ENCODE", message: message)
        }
        final.1.markAsFinished()
        await withCheckedContinuation { continuation in
            final.0.finishWriting { continuation.resume() }
        }
        guard final.0.status == .completed else {
            let message = final.0.error?.localizedDescription ?? "Failed to finalize action recording"
            throw HelperError(code: "ENCODE", message: message)
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: final.2
        )
        let duration = max(0, CMTimeGetSeconds(CMTimeSubtract(final.6 ?? first, first)))
        let result: [String: Any] = [
            "path": final.2,
            "mimeType": "video/mp4",
            "durationMs": Int((duration * 1000).rounded()),
            "width": final.3,
            "height": final.4,
        ]
        completed = true
        return result
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let pixelBuffer = sampleBuffer.imageBuffer else { return }
        withState {
            guard self.stream === stream, failure == nil,
                  let writer, let input, let adaptor else { return }
            let timestamp = sampleBuffer.presentationTimeStamp
            if writer.status == .unknown {
                guard writer.startWriting() else {
                    failure = writer.error ?? HelperError(code: "ENCODE", message: "Failed to start MP4 writer")
                    return
                }
                writer.startSession(atSourceTime: timestamp)
                firstTimestamp = timestamp
            }
            guard writer.status == .writing, input.isReadyForMoreMediaData else { return }
            if adaptor.append(pixelBuffer, withPresentationTime: timestamp) {
                lastTimestamp = timestamp
            } else {
                failure = writer.error ?? HelperError(code: "ENCODE", message: "Failed to append recording frame")
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        withState {
            if self.stream === stream { failure = error }
        }
    }

    private func clearState() {
        stream = nil
        writer = nil
        input = nil
        adaptor = nil
        outputPath = ""
        width = 0
        height = 0
        firstTimestamp = nil
        lastTimestamp = nil
        failure = nil
    }
}
