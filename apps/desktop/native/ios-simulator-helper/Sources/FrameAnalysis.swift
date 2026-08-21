import CoreImage
import Foundation
import IOSurface
import Vision

/**
 Pixel-side readings of the framebuffer: a perceptual hash and recognized text.

 Both exist because the accessibility tree is not always there. A React Native or
 Flutter screen, a WebView, a game canvas -- any of them can hand back a tree with
 one node in it, and every judgement the agent layer makes above (has the screen
 settled, did that tap do anything, is the label on screen yet) is built on
 comparing trees. These two readings give that layer a second source that no app
 can opt out of, because it reads the same pixels the user is looking at.

 Deliberately kept on this side of the socket. The host process could do it by
 asking for a PNG, but that means encode, copy, decode, and it would have to happen
 at settle-loop frequency; here the surface is already mapped and Vision is a
 framework call away.
 */
final class FrameAnalyzer {
  /// One context for the lifetime of the helper: creating a `CIContext` allocates a
  /// GPU command queue and shader cache, which is far more expensive than any single
  /// render it is used for.
  private let context = CIContext(options: [.useSoftwareRenderer: false])

  /// Bitmap the hash is computed over. 9 wide because dHash compares each pixel with
  /// its right-hand neighbour and therefore yields one fewer column than it samples.
  private static let hashWidth = 9
  private static let hashHeight = 8

  /// Keyed by recognition level, because the two levels support different sets --
  /// notably `.fast` has no Chinese.
  private var cachedLanguages: [Bool: Set<String>] = [:]

  // MARK: - Perceptual hash

  /**
   A 64-bit fingerprint of what the screen currently shows.

   Answers "is this the same picture as last time", not "what is on it". The agent
   layer uses it for two things the tree used to do alone: deciding an animation has
   settled, and deciding whether an action changed anything.

   Downsampling to 8x8 is the entire trick, and the reason it is this aggressive is
   not speed. At native resolution a phone screen is never still -- the status bar
   clock ticks, a caret blinks, a spinner turns -- so a strict pixel comparison
   reports motion forever and every settle wait runs to its timeout. At 8x8 none of
   those cover a cell, while anything a person would call a screen change does.

   dHash rather than a checksum of the bytes: it encodes relative brightness between
   neighbouring cells, so a uniform shift (a dimming animation, a rounding
   difference in the scaler) does not change it, while moved or replaced content
   does.
   */
  func perceptualHash(_ surface: IOSurfaceRef) -> String? {
    guard let gray = downsampledLuma(CIImage(ioSurface: surface)) else { return nil }
    var bits: UInt64 = 0
    for y in 0..<Self.hashHeight {
      for x in 0..<(Self.hashWidth - 1) {
        let left = gray[y * Self.hashWidth + x]
        let right = gray[y * Self.hashWidth + x + 1]
        bits = (bits << 1) | (left > right ? 1 : 0)
      }
    }
    return String(format: "%016llx", bits)
  }

  private func downsampledLuma(_ image: CIImage) -> [UInt8]? {
    let extent = image.extent
    guard extent.width > 0, extent.height > 0, extent.width.isFinite, extent.height.isFinite
    else { return nil }
    let width = Self.hashWidth
    let height = Self.hashHeight

    // Lanczos rather than a plain affine scale. Dropping a 1179x2556 framebuffer to
    // 9x8 by transform alone samples a handful of source pixels, so a one-pixel
    // scroll can flip a cell and read as a screen change; the resampling filter
    // averages the block instead, which is what makes the hash stable under motion
    // too small to see.
    let normalized = image.transformed(
      by: CGAffineTransform(translationX: -extent.origin.x, y: -extent.origin.y))
    let scaleY = CGFloat(height) / extent.height
    let scaleX = CGFloat(width) / extent.width
    guard let filter = CIFilter(name: "CILanczosScaleTransform") else { return nil }
    filter.setValue(normalized, forKey: kCIInputImageKey)
    filter.setValue(scaleY, forKey: kCIInputScaleKey)
    filter.setValue(scaleX / scaleY, forKey: kCIInputAspectRatioKey)
    guard let scaled = filter.outputImage else { return nil }

    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    pixels.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress else { return }
      context.render(
        scaled,
        toBitmap: base,
        rowBytes: width * 4,
        bounds: bounds,
        format: .RGBA8,
        colorSpace: CGColorSpaceCreateDeviceRGB())
    }

    return (0..<(width * height)).map { index in
      let r = Double(pixels[index * 4])
      let g = Double(pixels[index * 4 + 1])
      let b = Double(pixels[index * 4 + 2])
      return UInt8(min(255, (0.299 * r + 0.587 * g + 0.114 * b).rounded()))
    }
  }

  // MARK: - Text recognition

  /**
   Read the text on screen, with a box around each line.

   `rotationDegrees` is how far clockwise the framebuffer has to turn to be read
   upright -- the guest draws its rotated UI into the same portrait surface a real
   panel would, so in landscape the text is lying on its side and Vision, which
   assumes upright glyphs, finds close to nothing. Turning the image first is not an
   optimisation; without it landscape OCR simply fails.

   Boxes come back in the UPRIGHT image's space, normalized, top-left origin. The
   host turns them back into framebuffer coordinates with the same rotation it
   already applies to accessibility frames, so the mapping exists once rather than
   in two dialects that can disagree.
   */
  func recognizeText(
    _ surface: IOSurfaceRef,
    rotationDegrees: Int,
    languages: [String],
    fast: Bool,
    minimumConfidence: Float
  ) throws -> [[String: Any]] {
    let upright = rotate(CIImage(ioSurface: surface), clockwiseDegrees: rotationDegrees)
    let extent = upright.extent
    guard extent.width > 0, extent.height > 0 else { return [] }

    let request = VNRecognizeTextRequest()
    // `.accurate` is not a quality preference here: `.fast` recognizes Latin script
    // only, so a Chinese screen comes back empty or as garbage under it. Callers who
    // ask for fast get it, but the default has to be accurate.
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = !fast
    let requested = supportedLanguages(of: request, fast: fast).intersection(languages)
    // Passing an unsupported language makes `perform` throw and lose the whole
    // frame, so an unavailable one is dropped rather than allowed to fail the call.
    if !requested.isEmpty {
      request.recognitionLanguages = languages.filter { requested.contains($0) }
    }

    try VNImageRequestHandler(ciImage: upright, options: [:]).perform([request])

    return (request.results ?? []).compactMap { observation in
      guard let candidate = observation.topCandidates(1).first else { return nil }
      guard candidate.confidence >= minimumConfidence else { return nil }
      let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return nil }
      let box = observation.boundingBox
      return [
        "text": text,
        "confidence": Double(candidate.confidence),
        "x": Double(box.origin.x),
        // Vision reports a bottom-left origin, the Core Graphics convention. Every
        // consumer above speaks top-left, so it is flipped here rather than left for
        // each of them to remember.
        "y": Double(1 - (box.origin.y + box.size.height)),
        "width": Double(box.size.width),
        "height": Double(box.size.height),
      ]
    }
  }

  private func supportedLanguages(of request: VNRecognizeTextRequest, fast: Bool) -> Set<String> {
    if let cached = cachedLanguages[fast] { return cached }
    // Asked of the configured request rather than the deprecated type method, so the
    // answer reflects the recognition level actually about to run.
    let available = Set((try? request.supportedRecognitionLanguages()) ?? [])
    cachedLanguages[fast] = available
    return available
  }

  /**
   Turn the image clockwise as seen on screen.

   Core Image's y axis points up, so a clockwise turn on screen is a negative
   rotation here -- the sign is the whole reason this is a named function and not an
   inline transform. The translate afterwards puts the rotated extent back at the
   origin, which Vision requires: it normalizes boxes against the extent it is
   given, and an extent starting at a negative origin silently shifts every box.
   */
  private func rotate(_ image: CIImage, clockwiseDegrees: Int) -> CIImage {
    let normalized = ((clockwiseDegrees % 360) + 360) % 360
    guard normalized != 0 else { return image }
    let radians = -CGFloat(normalized) * .pi / 180
    let rotated = image.transformed(by: CGAffineTransform(rotationAngle: radians))
    return rotated.transformed(
      by: CGAffineTransform(
        translationX: -rotated.extent.origin.x, y: -rotated.extent.origin.y))
  }
}
