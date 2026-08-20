import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import IOSurface

enum NativeFrameKind: UInt8 {
  case png = 1
  case h264Config = 2
  case h264 = 3
}

final class FrameSocketWriter {
  private let fileDescriptor: Int32
  private let queue = DispatchQueue(label: "app.superone.ios-simulator.frames.write")
  private let lock = NSLock()
  private var closed = false
  private var queuedBytes = 0
  private let maximumQueuedBytes = 8 * 1024 * 1024

  init(path: String) throws {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      throw SimulatorBridgeError.displayUnavailable("Could not create frame socket.")
    }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard bytes.count < capacity else {
      Darwin.close(descriptor)
      throw SimulatorBridgeError.displayUnavailable("Frame socket path is too long.")
    }
    withUnsafeMutableBytes(of: &address.sun_path) { buffer in
      buffer.initializeMemory(as: UInt8.self, repeating: 0)
      buffer.copyBytes(from: bytes)
    }
    let status = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard status == 0 else {
      let detail = String(cString: strerror(errno))
      Darwin.close(descriptor)
      throw SimulatorBridgeError.displayUnavailable("Could not connect frame socket: \(detail)")
    }
    var noSignal: Int32 = 1
    setsockopt(
      descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
    fileDescriptor = descriptor
  }

  func write(
    kind: NativeFrameKind,
    keyframe: Bool = false,
    timestampUs: UInt64,
    payload: Data
  ) {
    let headerBytes = 12
    let packetBytes = headerBytes + payload.count
    lock.lock()
    guard !closed, queuedBytes + packetBytes <= maximumQueuedBytes else {
      lock.unlock()
      return
    }
    queuedBytes += packetBytes
    lock.unlock()
    queue.async { [weak self] in
      guard let self else { return }
      defer {
        self.lock.lock()
        self.queuedBytes -= packetBytes
        self.lock.unlock()
      }
      var packetLength = UInt32(packetBytes).littleEndian
      var timestamp = timestampUs.littleEndian
      // One buffer, one write. Two writes cost an extra syscall per frame and, worse,
      // guaranteed the reader saw a lone 12-byte chunk ahead of every payload — which
      // is precisely the split its parser then has to stitch back together.
      var packet = Data()
      packet.reserveCapacity(4 + packetBytes)
      withUnsafeBytes(of: &packetLength) { packet.append(contentsOf: $0) }
      packet.append(kind.rawValue)
      packet.append(keyframe ? 1 : 0)
      packet.append(contentsOf: [0, 0])
      withUnsafeBytes(of: &timestamp) { packet.append(contentsOf: $0) }
      packet.append(payload)
      if !self.writeAll(packet) { self.closeFromQueue() }
    }
  }

  private func writeAll(_ data: Data) -> Bool {
    data.withUnsafeBytes { bytes in
      guard let baseAddress = bytes.baseAddress else { return true }
      var offset = 0
      while offset < bytes.count {
        let count = Darwin.write(fileDescriptor, baseAddress + offset, bytes.count - offset)
        if count > 0 { offset += count; continue }
        if count < 0 && errno == EINTR { continue }
        return false
      }
      return true
    }
  }

  private func closeFromQueue() {
    lock.lock()
    let shouldClose = !closed
    closed = true
    lock.unlock()
    if shouldClose { Darwin.close(fileDescriptor) }
  }

  func close() {
    queue.sync { closeFromQueue() }
  }
}

final class FramebufferStream {
  private let descriptor: NSObject
  private let writer: FrameSocketWriter
  private let preferredCodec: String
  /** 0 means every repaint the simulator produces is forwarded. */
  private let minFrameIntervalNs: UInt64
  /** 1 keeps the device's own framebuffer size, which is the zero-copy path. */
  private let requestedScale: Double
  private let imageContext = CIContext(options: [.useSoftwareRenderer: false])
  private let encodeQueue = DispatchQueue(label: "app.superone.ios-simulator.frames.encode")
  private let gateQueue = DispatchQueue(label: "app.superone.ios-simulator.frames.gate")
  private let damageToken = NSUUID()
  private let surfaceToken = NSUUID()
  private let lock = NSLock()
  private var h264Encoder: H264Encoder?
  private var scalePool: CVPixelBufferPool?
  private var sourceWidth = 0
  private var sourceHeight = 0
  private var outputWidth = 0
  private var outputHeight = 0
  private var lastCaptureNs: UInt64 = 0
  private var pendingSurface: IOSurfaceRef?
  private var trailingScheduled = false
  private var queuedEncoding = false
  private var stopped = false
  private var damageRegistered = false
  private var surfaceRegistered = false

  init(
    descriptor: NSObject,
    socketPath: String,
    preferredCodec: String,
    maxFrameRate: Double,
    scale: Double
  ) throws {
    self.descriptor = descriptor
    self.preferredCodec = preferredCodec
    minFrameIntervalNs = maxFrameRate > 0 ? UInt64(1_000_000_000 / maxFrameRate) : 0
    requestedScale = scale
    writer = try FrameSocketWriter(path: socketPath)
  }

  /**
   * H.264 wants even dimensions — an odd edge costs a chroma row and some encoders
   * reject it outright — and nothing below 16px is worth previewing.
   */
  private static func outputSize(width: Int, height: Int, scale: Double) -> (Int, Int) {
    guard scale > 0, scale < 1 else { return (width, height) }
    return (
      max(16, Int((Double(width) * scale).rounded()) & ~1),
      max(16, Int((Double(height) * scale).rounded()) & ~1)
    )
  }

  private static func makeScalePool(width: Int, height: Int) -> CVPixelBufferPool? {
    let attributes: [CFString: Any] = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey: width,
      kCVPixelBufferHeightKey: height,
      kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
    ]
    var pool: CVPixelBufferPool?
    let status = CVPixelBufferPoolCreate(
      kCFAllocatorDefault, nil, attributes as CFDictionary, &pool)
    return status == kCVReturnSuccess ? pool : nil
  }

  func start() throws -> [String: Any] {
    guard let surface = descriptor.framebufferSurface() else {
      throw SimulatorBridgeError.displayUnavailable("Framebuffer disappeared during attach.")
    }
    sourceWidth = IOSurfaceGetWidth(surface)
    sourceHeight = IOSurfaceGetHeight(surface)
    (outputWidth, outputHeight) = Self.outputSize(
      width: sourceWidth, height: sourceHeight, scale: requestedScale)
    var mode = "png"
    var fallbackReason: String?
    if outputWidth != sourceWidth || outputHeight != sourceHeight {
      scalePool = Self.makeScalePool(width: outputWidth, height: outputHeight)
      if scalePool == nil {
        // Without a pool there is nowhere to render the scaled frame, and encoding
        // at a size the frames do not match would corrupt every one of them.
        fallbackReason = "Could not allocate a scaling buffer pool; using the native size."
        outputWidth = sourceWidth
        outputHeight = sourceHeight
      }
    }
    if preferredCodec == "h264" {
      do {
        h264Encoder = try H264Encoder(
          width: outputWidth, height: outputHeight, writer: writer)
        mode = "h264"
      } catch {
        fallbackReason = String(describing: error)
      }
    }
    capture(surface)

    let damageSelector = NSSelectorFromString("registerCallbackWithUUID:damageRectanglesCallback:")
    typealias DamageFunction = @convention(c) (
      AnyObject, Selector, NSUUID, @convention(block) (AnyObject?) -> Void
    ) -> Void
    if let implementation = descriptor.method(for: damageSelector) {
      let callback: @convention(block) (AnyObject?) -> Void = { [weak self] _ in
        guard let self, let surface = self.descriptor.framebufferSurface() else { return }
        self.capture(surface)
      }
      unsafeBitCast(implementation, to: DamageFunction.self)(
        descriptor, damageSelector, damageToken, callback)
      damageRegistered = true
    }

    let surfaceSelector = NSSelectorFromString("registerCallbackWithUUID:ioSurfacesChangeCallback:")
    typealias SurfaceFunction = @convention(c) (
      AnyObject, Selector, NSUUID, @convention(block) (AnyObject?, AnyObject?) -> Void
    ) -> Void
    if let implementation = descriptor.method(for: surfaceSelector) {
      let callback: @convention(block) (AnyObject?, AnyObject?) -> Void = { [weak self] _, value in
        guard let self, let value, CFGetTypeID(value) == IOSurfaceGetTypeID() else { return }
        self.capture(unsafeBitCast(value, to: IOSurfaceRef.self))
      }
      unsafeBitCast(implementation, to: SurfaceFunction.self)(
        descriptor, surfaceSelector, surfaceToken, callback)
      surfaceRegistered = true
    }
    guard damageRegistered || surfaceRegistered else {
      stop()
      throw SimulatorBridgeError.displayUnavailable("Framebuffer callbacks are unavailable.")
    }
    return [
      "pixelWidth": outputWidth,
      "pixelHeight": outputHeight,
      "codec": mode,
      "fallbackReason": fallbackReason as Any? ?? NSNull(),
    ]
  }

  private func capture(_ surface: IOSurfaceRef) {
    lock.lock()
    if stopped { lock.unlock(); return }
    if minFrameIntervalNs > 0 {
      let now = DispatchTime.now().uptimeNanoseconds
      let elapsed = now &- lastCaptureNs
      if elapsed < minFrameIntervalNs {
        // Hold the newest surface and send it when the window opens rather than
        // dropping it. A plain drop loses the last repaint of every burst, which
        // freezes the preview one frame short of where the device actually settled.
        pendingSurface = surface
        if !trailingScheduled {
          trailingScheduled = true
          let wait = minFrameIntervalNs - elapsed
          gateQueue.asyncAfter(deadline: .now() + .nanoseconds(Int(wait))) { [weak self] in
            self?.flushPending()
          }
        }
        lock.unlock()
        return
      }
      lastCaptureNs = now
      pendingSurface = nil
    }
    lock.unlock()
    deliver(surface)
  }

  private func flushPending() {
    lock.lock()
    trailingScheduled = false
    guard !stopped, let surface = pendingSurface else { lock.unlock(); return }
    pendingSurface = nil
    lastCaptureNs = DispatchTime.now().uptimeNanoseconds
    lock.unlock()
    deliver(surface)
  }

  private func deliver(_ surface: IOSurfaceRef) {
    lock.lock()
    if stopped { lock.unlock(); return }
    let encoder = h264Encoder
    let pool = scalePool
    // The zero-copy encoder path runs on its own pending-frame budget. Anything
    // that costs a render pass of its own gets one in flight at a time.
    if encoder == nil || pool != nil {
      if queuedEncoding { lock.unlock(); return }
      queuedEncoding = true
    }
    lock.unlock()

    if let encoder, pool == nil {
      // Native size: hand the framebuffer straight to VideoToolbox, no copy.
      encoder.encode(surface)
      return
    }

    let retained = Unmanaged.passRetained(surface as AnyObject)
    encodeQueue.async { [weak self] in
      defer {
        retained.release()
        self?.lock.lock()
        self?.queuedEncoding = false
        self?.lock.unlock()
      }
      guard let self else { return }
      var image = CIImage(ioSurface: surface)
      if self.outputWidth != self.sourceWidth || self.outputHeight != self.sourceHeight {
        image = image
          .transformed(by: CGAffineTransform(
            scaleX: Double(self.outputWidth) / Double(self.sourceWidth),
            y: Double(self.outputHeight) / Double(self.sourceHeight)))
          // Rounding to even pixels leaves the scaled extent a hair off; crop so the
          // frame matches the size the encoder was created with, exactly.
          .cropped(to: CGRect(
            x: 0, y: 0, width: self.outputWidth, height: self.outputHeight))
      }
      if let encoder, let pool {
        var created: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &created)
          == kCVReturnSuccess, let buffer = created
        else { return }
        self.imageContext.render(image, to: buffer)
        encoder.encode(buffer)
        return
      }
      guard let data = self.imageContext.pngRepresentation(
        of: image, format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
      else { return }
      self.writer.write(
        kind: .png,
        timestampUs: DispatchTime.now().uptimeNanoseconds / 1_000,
        payload: data)
    }
  }

  func stop() {
    lock.lock()
    if stopped { lock.unlock(); return }
    stopped = true
    pendingSurface = nil
    lock.unlock()
    if damageRegistered {
      let selector = NSSelectorFromString("unregisterDamageRectanglesCallbackWithUUID:")
      typealias Function = @convention(c) (AnyObject, Selector, NSUUID) -> Void
      if let implementation = descriptor.method(for: selector) {
        unsafeBitCast(implementation, to: Function.self)(descriptor, selector, damageToken)
      }
    }
    if surfaceRegistered {
      let selector = NSSelectorFromString("unregisterIOSurfacesChangeCallbackWithUUID:")
      typealias Function = @convention(c) (AnyObject, Selector, NSUUID) -> Void
      if let implementation = descriptor.method(for: selector) {
        unsafeBitCast(implementation, to: Function.self)(descriptor, selector, surfaceToken)
      }
    }
    h264Encoder?.stop()
    h264Encoder = nil
    scalePool = nil
    encodeQueue.sync {}
    writer.close()
  }
}
