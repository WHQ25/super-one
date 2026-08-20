import Foundation
import IOSurface

enum SimulatorBridgeError: Error, CustomStringConvertible {
  case unavailable(String)
  case deviceNotFound(String)
  case deviceNotBooted(String)
  case displayUnavailable(String)

  var description: String {
    switch self {
    case .unavailable(let message): return message
    case .deviceNotFound(let udid): return "Simulator \(udid) was not found."
    case .deviceNotBooted(let udid): return "Simulator \(udid) is not booted."
    case .displayUnavailable(let message): return "Simulator display is unavailable: \(message)"
    }
  }
}

func selectedDeveloperDirectory() -> String {
  if let value = ProcessInfo.processInfo.environment["DEVELOPER_DIR"], !value.isEmpty {
    return value
  }
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
  process.arguments = ["-p"]
  let output = Pipe()
  process.standardOutput = output
  process.standardError = FileHandle.nullDevice
  do {
    try process.run()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let value = String(data: data, encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !value.isEmpty { return value }
  } catch {}
  return "/Applications/Xcode.app/Contents/Developer"
}

func simulatorKitPaths(developerDirectory: String) -> [String] {
  let contents = (developerDirectory as NSString).deletingLastPathComponent
  return [
    developerDirectory + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
    contents + "/SharedFrameworks/SimulatorKit.framework/SimulatorKit",
  ]
}

@discardableResult
func loadSimulatorFrameworks(developerDirectory: String, requireSimulatorKit: Bool) throws
  -> UnsafeMutableRawPointer?
{
  let corePath = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
  guard dlopen(corePath, RTLD_NOW | RTLD_LOCAL) != nil else {
    throw SimulatorBridgeError.unavailable("Could not load CoreSimulator.framework.")
  }
  var simulatorKit: UnsafeMutableRawPointer?
  for path in simulatorKitPaths(developerDirectory: developerDirectory) {
    if let handle = dlopen(path, RTLD_NOW | RTLD_LOCAL) {
      simulatorKit = handle
      break
    }
  }
  if requireSimulatorKit && simulatorKit == nil {
    throw SimulatorBridgeError.unavailable("Could not load SimulatorKit.framework.")
  }
  return simulatorKit
}

struct SimulatorDeviceSet {
  let object: NSObject

  static func resolve(developerDirectory: String) throws -> SimulatorDeviceSet {
    guard let contextClass = NSClassFromString("SimServiceContext") as? NSObject.Type else {
      throw SimulatorBridgeError.unavailable("SimServiceContext is missing.")
    }
    let contextSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
    typealias ContextFunction = @convention(c) (
      AnyObject, Selector, NSString, AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> AnyObject?
    guard let contextImplementation = contextClass.method(for: contextSelector) else {
      throw SimulatorBridgeError.unavailable("CoreSimulator service selector is missing.")
    }
    var contextError: NSError?
    let context = withUnsafeMutablePointer(to: &contextError) { pointer -> AnyObject? in
      unsafeBitCast(contextImplementation, to: ContextFunction.self)(
        contextClass,
        contextSelector,
        developerDirectory as NSString,
        AutoreleasingUnsafeMutablePointer(pointer))
    }
    guard let context = context as? NSObject else {
      throw SimulatorBridgeError.unavailable(
        contextError?.localizedDescription ?? "CoreSimulator service context failed.")
    }

    let setSelector = NSSelectorFromString("defaultDeviceSetWithError:")
    typealias SetFunction = @convention(c) (
      AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>
    ) -> AnyObject?
    guard let setImplementation = context.method(for: setSelector) else {
      throw SimulatorBridgeError.unavailable("CoreSimulator device-set selector is missing.")
    }
    var setError: NSError?
    let set = withUnsafeMutablePointer(to: &setError) { pointer -> AnyObject? in
      unsafeBitCast(setImplementation, to: SetFunction.self)(
        context, setSelector, AutoreleasingUnsafeMutablePointer(pointer))
    }
    guard let set = set as? NSObject else {
      throw SimulatorBridgeError.unavailable(
        setError?.localizedDescription ?? "CoreSimulator device set failed.")
    }
    return SimulatorDeviceSet(object: set)
  }

  func device(udid: String) throws -> SimulatorDevice {
    guard let devices = object.value(forKey: "devices") as? NSArray else {
      throw SimulatorBridgeError.deviceNotFound(udid)
    }
    for value in devices {
      guard let object = value as? NSObject else { continue }
      let device = SimulatorDevice(object: object)
      if device.udid.caseInsensitiveCompare(udid) == .orderedSame { return device }
    }
    throw SimulatorBridgeError.deviceNotFound(udid)
  }
}

struct SimulatorDevice {
  let object: NSObject

  var udid: String {
    if let uuid = object.value(forKey: "UDID") as? NSUUID { return uuid.uuidString }
    return object.value(forKey: "UDID") as? String ?? ""
  }

  var state: Int { (object.value(forKey: "state") as? NSNumber)?.intValue ?? -1 }

  func mainDisplayDescriptor() throws -> NSObject {
    guard state == 3 else { throw SimulatorBridgeError.deviceNotBooted(udid) }
    guard let renderable = NSProtocolFromString("SimDisplayIOSurfaceRenderable"),
      let io = object.value(forKey: "io") as? NSObject,
      let ports = io.value(forKey: "ioPorts") as? NSArray
    else {
      throw SimulatorBridgeError.displayUnavailable("No renderable IO ports were published.")
    }

    let selector = NSSelectorFromString("descriptor")
    typealias DescriptorFunction = @convention(c) (AnyObject, Selector) -> AnyObject?
    var best: NSObject?
    var bestArea = 0
    for value in ports {
      guard let port = value as? NSObject,
        let implementation = port.method(for: selector),
        let descriptor = unsafeBitCast(implementation, to: DescriptorFunction.self)(port, selector)
          as? NSObject,
        descriptor.conforms(to: renderable),
        let surface = descriptor.framebufferSurface()
      else { continue }
      let area = IOSurfaceGetWidth(surface) * IOSurfaceGetHeight(surface)
      if area > bestArea {
        bestArea = area
        best = descriptor
      }
    }
    guard let best else {
      throw SimulatorBridgeError.displayUnavailable("No framebuffer surface is ready.")
    }
    return best
  }
}

extension NSObject {
  func framebufferSurface() -> IOSurfaceRef? {
    let selector = NSSelectorFromString("framebufferSurface")
    guard responds(to: selector), let result = perform(selector) else { return nil }
    let value = result.takeUnretainedValue()
    guard CFGetTypeID(value) == IOSurfaceGetTypeID() else { return nil }
    return unsafeBitCast(value, to: IOSurfaceRef.self)
  }
}
