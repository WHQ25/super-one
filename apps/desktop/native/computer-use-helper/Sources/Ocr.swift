/**
 * Text recognition over a capture, via Apple's Vision framework.
 *
 * This is the mirroring backend's ELEMENT TREE, and it is worth being blunt about why.
 * A simulator hands over a real accessibility tree through AXPTranslator; Android hands
 * over one through `uiautomator dump`. iPhone Mirroring hands over neither — the phone
 * is a video stream, and accessibility cannot see into it. OCR is not a fallback that
 * kicks in when the tree is unavailable; on this provider there IS no tree, and every
 * layer above has to be told so rather than discovering it as an empty result.
 *
 * What comes back is deliberately in IMAGE coordinates, matching the capture it was
 * run on. The helper already knows how to turn a point in a capture into a point on
 * screen — `resolveCoordinatePoint` with `coordinateKind: "window"` — and it re-checks
 * the window's geometry while doing it, so a phrase recognized before the user moved
 * the window cannot be clicked at a stale location. Converting to screen points here
 * would throw that check away.
 *
 * Credit: the normalized-box conversion follows phone-harness (MIT, © 2026 shawn pana),
 * `ocr.py`.
 */

import CoreGraphics
import Foundation
import Vision

/**
 * Recognize text in a PNG, returning boxes in the image's own pixel space.
 *
 * Takes encoded bytes rather than capturing itself, which keeps one capture serving
 * both the picture the user watches and the text the agent reads. Two SCK captures per
 * observation would double the cost and leave the two answers describing different
 * moments.
 */
func recognizeText(pngData: Data, minConfidence: Double) throws -> [[String: Any]] {
    guard let source = CGImageSourceCreateWithData(pngData as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw HelperError(code: "DECODE", message: "Could not decode the capture for recognition")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Left on: a phone screen is mostly ordinary prose, and the model's language
    // correction is what turns near-misses into the exact label the agent then taps.
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])

    let width = Double(image.width)
    let height = Double(image.height)
    var out: [[String: Any]] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let confidence = Double(candidate.confidence)
        if confidence < minConfidence { continue }
        // Vision's normalized boxes have a bottom-left origin; image pixels have a
        // top-left one. Without the flip every tap lands mirrored about the middle of
        // the screen — which looks like a working integration that presses the wrong
        // button, the worst possible failure mode.
        let box = observation.boundingBox
        let x = box.origin.x * width
        let y = (1.0 - box.origin.y - box.size.height) * height
        let w = box.size.width * width
        let h = box.size.height * height
        out.append([
            "text": candidate.string,
            "confidence": (confidence * 1000).rounded() / 1000,
            "x": (x * 10).rounded() / 10,
            "y": (y * 10).rounded() / 10,
            "width": (w * 10).rounded() / 10,
            "height": (h * 10).rounded() / 10,
        ])
    }
    return out
}
