import CoreMedia
import CoreVideo
import Foundation
import IOSurface
import VideoToolbox

enum H264EncoderError: Error, CustomStringConvertible {
  case setup(OSStatus)

  var description: String {
    switch self {
    case .setup(let status): return "VideoToolbox encoder setup failed (\(status))."
    }
  }
}

private let h264OutputCallback: VTCompressionOutputCallback = {
  outputCallbackRefCon, _, status, _, sampleBuffer in
  guard let outputCallbackRefCon else { return }
  let encoder = Unmanaged<H264Encoder>.fromOpaque(outputCallbackRefCon).takeUnretainedValue()
  encoder.handleOutput(status: status, sampleBuffer: sampleBuffer)
}

final class H264Encoder {
  private let width: Int
  private let height: Int
  private let writer: FrameSocketWriter
  private let lock = NSLock()
  private var session: VTCompressionSession?
  private var pendingFrames = 0
  private var stopped = false
  private var forceKeyframe = true
  /** Guarded like every other mutable field: `handleOutput` runs on VideoToolbox's thread. */
  private var sentConfiguration = false

  init(width: Int, height: Int, writer: FrameSocketWriter) throws {
    self.width = width
    self.height = height
    self.writer = writer

    let encoderSpecification = [
      kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String: true
    ] as CFDictionary
    var created: VTCompressionSession?
    let createStatus = VTCompressionSessionCreate(
      allocator: kCFAllocatorDefault,
      width: Int32(width),
      height: Int32(height),
      codecType: kCMVideoCodecType_H264,
      encoderSpecification: encoderSpecification,
      imageBufferAttributes: nil,
      compressedDataAllocator: nil,
      outputCallback: h264OutputCallback,
      refcon: Unmanaged.passUnretained(self).toOpaque(),
      compressionSessionOut: &created)
    guard createStatus == noErr, let created else { throw H264EncoderError.setup(createStatus) }
    session = created

    let pixels = width * height
    let bitrate = min(max(pixels * 2, 2_000_000), 12_000_000)
    let properties: [(CFString, CFTypeRef)] = [
      (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
      (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse),
      (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Main_AutoLevel),
      (kVTCompressionPropertyKey_ExpectedFrameRate, 30 as CFNumber),
      (kVTCompressionPropertyKey_MaxKeyFrameInterval, 60 as CFNumber),
      (kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 1 as CFNumber),
      (kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber),
      (kVTCompressionPropertyKey_DataRateLimits, [bitrate / 8, 1] as CFArray),
    ]
    for (key, value) in properties {
      let status = VTSessionSetProperty(created, key: key, value: value)
      guard status == noErr else { stop(); throw H264EncoderError.setup(status) }
    }
    let prepareStatus = VTCompressionSessionPrepareToEncodeFrames(created)
    guard prepareStatus == noErr else { stop(); throw H264EncoderError.setup(prepareStatus) }
  }

  /** Wraps the framebuffer in place — no copy — and encodes it at its native size. */
  func encode(_ surface: IOSurfaceRef) {
    var unmanagedPixelBuffer: Unmanaged<CVPixelBuffer>?
    let pixelStatus = CVPixelBufferCreateWithIOSurface(
      kCFAllocatorDefault, surface, nil, &unmanagedPixelBuffer)
    guard pixelStatus == kCVReturnSuccess, let unmanagedPixelBuffer else { return }
    encode(unmanagedPixelBuffer.takeRetainedValue())
  }

  /** The scaled path hands over a buffer it rendered itself. */
  func encode(_ pixelBuffer: CVPixelBuffer) {
    lock.lock()
    guard !stopped, pendingFrames < 3, let session else { lock.unlock(); return }
    pendingFrames += 1
    let keyframe = forceKeyframe
    forceKeyframe = false
    lock.unlock()

    let timestampUs = DispatchTime.now().uptimeNanoseconds / 1_000
    let presentationTime = CMTime(value: Int64(timestampUs), timescale: 1_000_000)
    let properties = keyframe
      ? [kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary
      : nil
    var flags = VTEncodeInfoFlags()
    let status = VTCompressionSessionEncodeFrame(
      session,
      imageBuffer: pixelBuffer,
      presentationTimeStamp: presentationTime,
      duration: .invalid,
      frameProperties: properties,
      sourceFrameRefcon: nil,
      infoFlagsOut: &flags)
    if status != noErr { finishFrame() }
  }

  fileprivate func handleOutput(status: OSStatus, sampleBuffer: CMSampleBuffer?) {
    defer { finishFrame() }
    guard status == noErr, let sampleBuffer, CMSampleBufferDataIsReady(sampleBuffer),
      let format = CMSampleBufferGetFormatDescription(sampleBuffer),
      let block = CMSampleBufferGetDataBuffer(sampleBuffer)
    else { return }

    let keyframe = isKeyframe(sampleBuffer)
    var nalHeaderLength: Int32 = 4
    var prefix = Data()
    if keyframe {
      var parameterCount = 0
      let countStatus = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        format,
        parameterSetIndex: 0,
        parameterSetPointerOut: nil,
        parameterSetSizeOut: nil,
        parameterSetCountOut: &parameterCount,
        nalUnitHeaderLengthOut: &nalHeaderLength)
      guard countStatus == noErr else { return }
      for index in 0..<parameterCount {
        var pointer: UnsafePointer<UInt8>?
        var size = 0
        let parameterStatus = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
          format,
          parameterSetIndex: index,
          parameterSetPointerOut: &pointer,
          parameterSetSizeOut: &size,
          parameterSetCountOut: nil,
          nalUnitHeaderLengthOut: nil)
        guard parameterStatus == noErr, let pointer else { return }
        prefix.append(contentsOf: [0, 0, 0, 1])
        prefix.append(pointer, count: size)
        if index == 0 && size >= 4 && takeConfigurationSlot() {
          let codec = String(format: "avc1.%02X%02X%02X", pointer[1], pointer[2], pointer[3])
          writer.write(
            kind: .h264Config,
            timestampUs: presentationTimestampUs(sampleBuffer),
            payload: Data(codec.utf8))
        }
      }
    }

    let totalLength = CMBlockBufferGetDataLength(block)
    var avcc = Data(count: totalLength)
    let copyStatus = avcc.withUnsafeMutableBytes { bytes in
      CMBlockBufferCopyDataBytes(
        block,
        atOffset: 0,
        dataLength: totalLength,
        destination: bytes.baseAddress!)
    }
    guard copyStatus == kCMBlockBufferNoErr,
      let annexB = Self.convertToAnnexB(avcc, nalHeaderLength: Int(nalHeaderLength), prefix: prefix)
    else { return }
    writer.write(
      kind: .h264,
      keyframe: keyframe,
      timestampUs: presentationTimestampUs(sampleBuffer),
      payload: annexB)
  }

  /** Claims the one-shot config send, so two output threads cannot both take it. */
  private func takeConfigurationSlot() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if sentConfiguration { return false }
    sentConfiguration = true
    return true
  }

  private func finishFrame() {
    lock.lock()
    pendingFrames = max(0, pendingFrames - 1)
    lock.unlock()
  }

  private func presentationTimestampUs(_ sampleBuffer: CMSampleBuffer) -> UInt64 {
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard time.isNumeric, time.timescale > 0 else {
      return DispatchTime.now().uptimeNanoseconds / 1_000
    }
    return UInt64(max(0, time.value)) * 1_000_000 / UInt64(time.timescale)
  }

  private func isKeyframe(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
      sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
      let first = attachments.first
    else { return true }
    return (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true
  }

  private static func convertToAnnexB(
    _ avcc: Data,
    nalHeaderLength: Int,
    prefix: Data
  ) -> Data? {
    guard nalHeaderLength > 0, nalHeaderLength <= 4 else { return nil }
    var result = prefix
    var offset = 0
    while offset + nalHeaderLength <= avcc.count {
      var length = 0
      for byte in avcc[offset..<(offset + nalHeaderLength)] {
        length = (length << 8) | Int(byte)
      }
      offset += nalHeaderLength
      guard length > 0, offset + length <= avcc.count else { return nil }
      result.append(contentsOf: [0, 0, 0, 1])
      result.append(avcc[offset..<(offset + length)])
      offset += length
    }
    return offset == avcc.count ? result : nil
  }

  func stop() {
    lock.lock()
    if stopped { lock.unlock(); return }
    stopped = true
    let current = session
    lock.unlock()
    if let current {
      VTCompressionSessionCompleteFrames(current, untilPresentationTimeStamp: .invalid)
      VTCompressionSessionInvalidate(current)
    }
    lock.lock()
    session = nil
    lock.unlock()
  }
}
