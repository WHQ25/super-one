import ExpoModulesCore
import ImageIO
import UIKit
import Vision

public class QrScannerModule: Module {
  private let queue = DispatchQueue(label: "dev.superone.qr-scanner", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("SuperOneQrScanner")

    AsyncFunction("scanImageAsync") { (uri: String, promise: Promise) in
      self.queue.async {
        guard let url = Self.resolveFileUrl(uri),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
          promise.reject("ERR_QR_IMAGE", "Could not decode image")
          return
        }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let rawOrientation = properties?[kCGImagePropertyOrientation] as? UInt32
        let orientation = rawOrientation.flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up
        let swapped = Self.swapsDimensions(orientation)
        let width = swapped ? cgImage.height : cgImage.width
        let height = swapped ? cgImage.width : cgImage.height

        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        do {
          try handler.perform([request])
          let observations = request.results ?? []
          let w = Double(width)
          let h = Double(height)
          let barcodes: [[String: Any]] = observations.compactMap { item in
            guard let payload = item.payloadStringValue, !payload.isEmpty else { return nil }
            let corners: [[String: Double]] = [
              ["x": Double(item.topLeft.x) * w, "y": Double(1 - item.topLeft.y) * h],
              ["x": Double(item.topRight.x) * w, "y": Double(1 - item.topRight.y) * h],
              ["x": Double(item.bottomRight.x) * w, "y": Double(1 - item.bottomRight.y) * h],
              ["x": Double(item.bottomLeft.x) * w, "y": Double(1 - item.bottomLeft.y) * h],
            ]
            let box = item.boundingBox
            let bounds: [String: [String: Double]] = [
              "origin": ["x": Double(box.minX) * w, "y": Double(1 - box.maxY) * h],
              "size": ["width": Double(box.width) * w, "height": Double(box.height) * h],
            ]
            return [
              "type": "qr",
              "data": payload,
              "cornerPoints": corners,
              "bounds": bounds,
            ]
          }
          promise.resolve([
            "width": width,
            "height": height,
            "barcodes": barcodes,
          ])
        } catch {
          promise.reject("ERR_QR_SCAN", error.localizedDescription)
        }
      }
    }
  }

  private static func resolveFileUrl(_ uri: String) -> URL? {
    if let url = URL(string: uri), url.isFileURL {
      return url
    }
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    return nil
  }

  private static func swapsDimensions(_ orientation: CGImagePropertyOrientation) -> Bool {
    switch orientation {
    case .left, .leftMirrored, .right, .rightMirrored:
      return true
    default:
      return false
    }
  }
}
