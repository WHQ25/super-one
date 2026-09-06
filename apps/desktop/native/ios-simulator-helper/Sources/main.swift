import AppKit
import Darwin
import Foundation
import IOSurface

private let protocolVersion = 9
private let writeLock = NSLock()

private func emit(_ value: Any) {
  guard JSONSerialization.isValidJSONObject(value),
    let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  else { return }
  writeLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
  writeLock.unlock()
}

private func probe() -> [String: Any] {
  let developerDirectory = selectedDeveloperDirectory()
  var missing: [String] = []
  let simulatorKit = try? loadSimulatorFrameworks(
    developerDirectory: developerDirectory, requireSimulatorKit: false)
  if NSClassFromString("SimServiceContext") == nil { missing.append("SimServiceContext") }
  if NSProtocolFromString("SimDisplayIOSurfaceRenderable") == nil {
    missing.append("SimDisplayIOSurfaceRenderable")
  }
  let hidSymbols = [
    "IndigoHIDMessageForHIDArbitrary", "IndigoHIDMessageForButton",
    "IndigoHIDMessageForKeyboardArbitrary", "IndigoHIDMessageForMouseNSEvent",
  ]
  let hasHID = simulatorKit != nil && hidSymbols.allSatisfy {
    let found = dlsym(simulatorKit!, $0) != nil
    if !found { missing.append($0) }
    return found
  }
  let hidClass = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient") != nil
    || NSClassFromString("_TtC12SimulatorKit24SimDeviceLegacyHIDClient") != nil
  if !hidClass { missing.append("SimDeviceLegacyHIDClient") }
  // Rotation needs no SimulatorKit symbol at all -- only CoreSimulator's port
  // lookup, which is how the guest workspace is reached.
  let rotation = (NSClassFromString("SimDevice") as? NSObject.Type)?
    .instancesRespond(to: NSSelectorFromString("lookup:error:")) ?? false
  if !rotation { missing.append("SimDevice.lookup:error:") }
  let accessibilityPath = "/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation"
  let accessibility = dlopen(accessibilityPath, RTLD_NOW | RTLD_LOCAL)
  let videoToolbox = dlopen(
    "/System/Library/Frameworks/VideoToolbox.framework/VideoToolbox", RTLD_NOW | RTLD_LOCAL)
  return [
    "protocolVersion": protocolVersion,
    "developerDirectory": developerDirectory,
    "simulatorKitPath": simulatorKitPaths(developerDirectory: developerDirectory)
      .first(where: { FileManager.default.fileExists(atPath: $0) }) as Any? ?? NSNull(),
    "capabilities": [
      "coreSimulator": NSClassFromString("SimServiceContext") != nil,
      "framebuffer": NSProtocolFromString("SimDisplayIOSurfaceRenderable") != nil,
      "hid": hasHID && hidClass,
      "rotation": rotation,
      // Not just "is the class there": the translator is useless without the guest
      // channel CoreSimulator has to expose, and the two version independently.
      "accessibility": accessibility != nil && S1AccessibilityBridge.supported,
      "videoEncoder": videoToolbox != nil && dlsym(videoToolbox, "VTCompressionSessionCreate") != nil,
    ],
    "missingSymbols": missing,
  ]
}

if CommandLine.arguments.contains("--probe") {
  emit(probe())
  exit(EXIT_SUCCESS)
}

private let simulatorAppBundleIdentifier = "com.apple.iphonesimulator"

private func runningSimulatorApps() -> [NSRunningApplication] {
  NSRunningApplication.runningApplications(withBundleIdentifier: simulatorAppBundleIdentifier)
}

/**
 * Put Apple's Simulator.app out of sight.
 *
 * `simctl boot` is headless, but a Simulator.app that is ALREADY up watches
 * CoreSimulator's device notifications and opens a window for anything that boots --
 * including the device this app just took for its own preview. Closing that window is
 * not an option: Simulator.app reads a close as "done with this device" and shuts the
 * guest down underneath us. Hiding is the only move that leaves the device running.
 *
 * `hide()` reports `false` even when it works, so its return value is not a reading;
 * `isHidden` after a runloop turn is.
 */
private func hideSimulatorApps() {
  for app in runningSimulatorApps() where !app.isHidden { app.hide() }
}

/**
 * Hide Apple's Simulator.app now, and again every time one launches.
 *
 * Launch only, deliberately. Hiding on unhide or activate as well would mean the user
 * could never look at Simulator.app at all while this app held a device -- every
 * Cmd-Tab to it would be undone. Launch is the one signal that is unambiguously not
 * the user asking for it: something else (Xcode, `flutter run`, `expo run:ios`)
 * started the app on their behalf.
 *
 * Launch is also the whole remaining surface. Measured: `open -n -a Simulator`, which
 * is exactly what flutter_tools runs, does NOT unhide an instance that is already
 * running and hidden -- macOS refuses the second instance and the first stays put. So
 * once it is hidden it stays hidden until the user says otherwise.
 */
if CommandLine.arguments.contains("--watch-simulator-app") {
  hideSimulatorApps()

  NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
  ) { note in
    guard
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
      app.bundleIdentifier == simulatorAppBundleIdentifier
    else { return }
    // An app still finishing its launch can swallow a hide, and its device window
    // arrives later again, so the first attempt is retried rather than trusted.
    app.hide()
    for delay in [0.4, 1.0, 2.0] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        if !app.isTerminated && !app.isHidden { app.hide() }
      }
    }
    emit(["event": "hidden", "pid": app.processIdentifier])
  }

  emit(["event": "watching", "running": !runningSimulatorApps().isEmpty])

  // The same stop signal the session helper uses: the parent closing stdin. That
  // covers the parent dying too, so this can never outlive the app that started it.
  DispatchQueue(label: "app.superone.ios-simulator.simulator-watch").async {
    while readLine() != nil {}
    exit(EXIT_SUCCESS)
  }
  RunLoop.main.run()
}

private enum RequestError: Error, CustomStringConvertible {
  case invalid(String)
  case unavailable(String)
  var description: String {
    switch self { case .invalid(let message), .unavailable(let message): return message }
  }
}

private final class HelperSession {
  let deviceSet: SimulatorDeviceSet
  private var device: SimulatorDevice?
  private var display: NSObject?
  private var hid: S1HIDBridge?
  private var orientation: S1OrientationBridge?
  private var accessibility: S1AccessibilityBridge?
  private var stream: FramebufferStream?
  /// Held for the session, not per request: it owns a `CIContext` whose setup cost
  /// dwarfs the renders it performs, and the settle loop calls in every 150ms.
  private let frameAnalyzer = FrameAnalyzer()

  init(deviceSet: SimulatorDeviceSet) { self.deviceSet = deviceSet }

  func attach(udid: String) throws -> [String: Any] {
    stopStream()
    cancelTouch()
    let device = try deviceSet.device(udid: udid)
    let display = try device.mainDisplayDescriptor()
    guard let surface = display.framebufferSurface() else {
      throw RequestError.unavailable("Framebuffer is not ready.")
    }
    let hid = S1HIDBridge()
    var hidError: NSError?
    let inputAvailable: Bool
    // Whether the guest took the opening hardware-keyboard state. It doubles as the
    // capability flag: a CoreSimulator that accepted it can be toggled later, and
    // one that refused has no switch to offer.
    var keyboardConnected = false
    do {
      try hid.attach(toDevice: device.object)
      inputAvailable = true
      // Pushed rather than read: CoreSimulator has no getter, and a device booted by
      // simctl instead of Simulator.app was never told either way, so the only way
      // the host can draw an honest toggle is to decide the opening state itself.
      // A refusal is not fatal -- typing still works, the toggle just goes missing.
      keyboardConnected = (try? hid.setHardwareKeyboardConnected(true)) != nil
    } catch {
      hidError = error as NSError
      inputAvailable = false
    }
    // Rotation rides a different channel than HID, so it is attached separately: a
    // simulator whose HID client refuses to bind can still be rotated.
    let orientation = S1OrientationBridge()
    var rotationError: NSError?
    let rotationAvailable: Bool
    do {
      try orientation.attach(toDevice: device.object)
      rotationAvailable = true
    } catch {
      rotationError = error as NSError
      rotationAvailable = false
    }
    // Accessibility rides a third channel -- CoreSimulator's own XPC service -- so it
    // is attached separately again: it stays available on a device whose HID client
    // and workspace port both refused to bind.
    let accessibility = S1AccessibilityBridge()
    var accessibilityError: NSError?
    let accessibilityAvailable: Bool
    do {
      try accessibility.attach(toDevice: device.object)
      accessibilityAvailable = true
    } catch {
      accessibilityError = error as NSError
      accessibilityAvailable = false
    }
    self.device = device
    self.display = display
    self.hid = inputAvailable ? hid : nil
    self.orientation = rotationAvailable ? orientation : nil
    self.accessibility = accessibilityAvailable ? accessibility : nil
    return [
      "udid": device.udid,
      "pixelWidth": IOSurfaceGetWidth(surface),
      "pixelHeight": IOSurfaceGetHeight(surface),
      "inputAvailable": inputAvailable,
      "inputError": hidError?.localizedDescription as Any? ?? NSNull(),
      "keyboardAvailable": keyboardConnected,
      "rotationAvailable": rotationAvailable,
      "rotationError": rotationError?.localizedDescription as Any? ?? NSNull(),
      "accessibilityAvailable": accessibilityAvailable,
      "accessibilityError": accessibilityError?.localizedDescription as Any? ?? NSNull(),
    ]
  }

  func startStream(
    socketPath: String,
    preferredCodec: String,
    maxFrameRate: Double,
    scale: Double
  ) throws -> [String: Any] {
    guard stream == nil else { throw RequestError.invalid("Frame stream is already running.") }
    guard let device else { throw RequestError.unavailable("Attach before starting the stream.") }
    // A running guest can replace its display without killing this helper.
    let display = try device.mainDisplayDescriptor()
    self.display = display
    let stream = try FramebufferStream(
      descriptor: display,
      socketPath: socketPath,
      preferredCodec: preferredCodec,
      maxFrameRate: maxFrameRate,
      scale: scale)
    let result = try stream.start()
    self.stream = stream
    return result
  }

  func stopStream() {
    stream?.stop()
    stream = nil
  }

  func cancelTouch() {
    hid?.cancelTouch()
  }

  /**
   The framebuffer as it looks right now.

   Re-read on every call rather than cached from `attach`: CoreSimulator swaps the
   surface out from under a display on rotation and on some app launches, and a
   retained one keeps returning the last picture it held -- which reads as a screen
   that never changes, the exact conclusion the hash exists to prevent.
   */
  func currentSurface() throws -> IOSurfaceRef {
    guard let display else {
      throw RequestError.unavailable("Attach before reading the framebuffer.")
    }
    guard let surface = display.framebufferSurface() else {
      throw RequestError.unavailable("Framebuffer is not ready.")
    }
    return surface
  }

  func requireOrientation() throws -> S1OrientationBridge {
    guard let orientation else { throw RequestError.unavailable("Rotation is unavailable.") }
    return orientation
  }

  func requireHID() throws -> S1HIDBridge {
    guard let hid else { throw RequestError.unavailable("HID input is unavailable.") }
    return hid
  }

  func requireAccessibility() throws -> S1AccessibilityBridge {
    guard let accessibility else {
      throw RequestError.unavailable("Guest accessibility is unavailable.")
    }
    return accessibility
  }

  func perform(method: String, params: [String: Any]) throws -> Any {
    switch method {
    case "ping": return ["pid": ProcessInfo.processInfo.processIdentifier]
    case "attach":
      guard let udid = params["udid"] as? String, !udid.isEmpty else {
        throw RequestError.invalid("attach.udid is required.")
      }
      return try attach(udid: udid)
    case "stream.start":
      guard let socketPath = params["socketPath"] as? String, !socketPath.isEmpty else {
        throw RequestError.invalid("stream.start.socketPath is required.")
      }
      let preferredCodec = params["preferredCodec"] as? String ?? "h264"
      guard preferredCodec == "h264" || preferredCodec == "png" else {
        throw RequestError.invalid("stream.start.preferredCodec must be h264 or png.")
      }
      // Both are optional and clamped here rather than trusted: the caller is our
      // own main process, but a bad value would misconfigure the encoder for the
      // whole session with no way to tell from the frames.
      let maxFrameRate = min(max(params["maxFrameRate"] as? Double ?? 0, 0), 240)
      let scale = min(max(params["scale"] as? Double ?? 1, 0.1), 1)
      return try startStream(
        socketPath: socketPath,
        preferredCodec: preferredCodec,
        maxFrameRate: maxFrameRate,
        scale: scale)
    case "stream.stop": stopStream(); return ["running": false]
    case "touch.update":
      let hid = try requireHID()
      guard let rawContacts = params["contacts"] as? [[String: Any]],
        !rawContacts.isEmpty, rawContacts.count <= 2
      else { throw RequestError.invalid("touch.update.contacts must contain one or two contacts.") }
      var identifiers = Set<Int>()
      let contacts: [[String: NSNumber]] = try rawContacts.map { contact in
        guard let identifierValue = contact["id"] as? NSNumber,
          identifierValue.doubleValue.rounded() == identifierValue.doubleValue,
          identifierValue.intValue > 0,
          identifierValue.intValue <= Int(Int32.max),
          identifiers.insert(identifierValue.intValue).inserted
        else { throw RequestError.invalid("Touch contact ids must be unique integers.") }
        let identifier = identifierValue.intValue
        guard let phaseName = contact["phase"] as? String else {
          throw RequestError.invalid("Touch contact phase is required.")
        }
        let phase: S1TouchPhase
        switch phaseName {
        case "began": phase = .began
        case "moved": phase = .moved
        case "ended": phase = .ended
        case "cancelled": phase = .cancelled
        default: throw RequestError.invalid("Unknown touch phase \(phaseName).")
        }
        return [
          "id": NSNumber(value: identifier),
          "x": NSNumber(value: try ratio(contact, "xRatio")),
          "y": NSNumber(value: try ratio(contact, "yRatio")),
          "phase": NSNumber(value: phase.rawValue),
        ]
      }
      let before = hid.failedEventCount
      hid.updateTouches(contacts)
      try ensureDelivered(hid, before)
      return ["ok": true]
    case "touch.cancel":
      cancelTouch()
      return ["ok": true]
    case "tap":
      let hid = try requireHID()
      cancelTouch()
      let x = try ratio(params, "xRatio")
      let y = try ratio(params, "yRatio")
      let before = hid.failedEventCount
      hid.tap(x: x, y: y, holdMs: 70)
      try ensureDelivered(hid, before)
      return ["ok": true]
    case "drag":
      let hid = try requireHID()
      cancelTouch()
      let before = hid.failedEventCount
      hid.drag(
        startX: try ratio(params, "startXRatio"), startY: try ratio(params, "startYRatio"),
        endX: try ratio(params, "endXRatio"), endY: try ratio(params, "endYRatio"),
        durationMs: (params["durationMs"] as? NSNumber)?.intValue ?? 250)
      try ensureDelivered(hid, before)
      return ["ok": true]
    case "text":
      guard let text = params["text"] as? String else {
        throw RequestError.invalid("text.text is required.")
      }
      let hid = try requireHID()
      let before = hid.failedEventCount
      let skipped = hid.type(text: text)
      try ensureDelivered(hid, before)
      return ["ok": true, "skippedCharacters": skipped]
    case "insertText":
      guard let text = params["text"] as? String else {
        throw RequestError.invalid("insertText.text is required.")
      }
      let accessibility = try requireAccessibility()
      do {
        try accessibility.insert(text: text)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
      return ["ok": true]
    case "rotate":
      guard let name = params["orientation"] as? String else {
        throw RequestError.invalid("rotate.orientation is required.")
      }
      var value = S1DeviceOrientation.portrait
      guard S1DeviceOrientationFromName(name, &value) else {
        throw RequestError.invalid("Unknown orientation \(name).")
      }
      let orientation = try requireOrientation()
      do {
        try orientation.apply(value)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
      return ["orientation": name]
    case "keyboard":
      guard let connected = params["connected"] as? Bool else {
        throw RequestError.invalid("keyboard.connected is required.")
      }
      let hid = try requireHID()
      do {
        try hid.setHardwareKeyboardConnected(connected)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
      return ["connected": connected]
    case "button":
      guard let name = params["button"] as? String else {
        throw RequestError.invalid("button.button is required.")
      }
      var button = S1HardwareButton.home
      guard S1HardwareButtonFromName(name, &button) else {
        throw RequestError.invalid("Unknown hardware button \(name).")
      }
      let hid = try requireHID()
      let before = hid.failedEventCount
      hid.tapButton(button)
      try ensureDelivered(hid, before)
      return ["ok": true]
    case "frame.hash":
      let surface = try currentSurface()
      guard let hash = frameAnalyzer.perceptualHash(surface) else {
        throw RequestError.unavailable("The framebuffer could not be sampled.")
      }
      return [
        "hash": hash,
        "pixelWidth": IOSurfaceGetWidth(surface),
        "pixelHeight": IOSurfaceGetHeight(surface),
      ]
    case "frame.ocr":
      let surface = try currentSurface()
      // Clamped and defaulted here for the same reason the other knobs are: a bad
      // value would degrade every reading of the session with nothing in the result
      // to show why.
      let rotationDegrees = (params["rotationDegrees"] as? NSNumber)?.intValue ?? 0
      guard rotationDegrees % 90 == 0 else {
        throw RequestError.invalid("frame.ocr.rotationDegrees must be a multiple of 90.")
      }
      let languages = (params["languages"] as? [String])?.filter { !$0.isEmpty } ?? []
      let fast = params["fast"] as? Bool ?? false
      let minimumConfidence = Float(
        min(max((params["minimumConfidence"] as? NSNumber)?.doubleValue ?? 0.3, 0), 1))
      do {
        let lines = try frameAnalyzer.recognizeText(
          surface,
          rotationDegrees: rotationDegrees,
          languages: languages.isEmpty ? ["zh-Hans", "en-US"] : languages,
          fast: fast,
          minimumConfidence: minimumConfidence)
        return [
          "lines": lines,
          "rotationDegrees": rotationDegrees,
          "pixelWidth": IOSurfaceGetWidth(surface),
          "pixelHeight": IOSurfaceGetHeight(surface),
        ]
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
    case "accessibility.dump":
      let accessibility = try requireAccessibility()
      // Clamped rather than trusted, for the same reason stream.start clamps its
      // knobs: a bad ceiling here would quietly truncate every snapshot of the
      // session, and a truncated tree looks exactly like a shallow screen.
      let maxDepth = min(max((params["maxDepth"] as? NSNumber)?.intValue ?? 24, 1), 64)
      let maxNodes = min(max((params["maxNodes"] as? NSNumber)?.intValue ?? 500, 1), 5000)
      do {
        return try accessibility.dumpTree(maxDepth: maxDepth, maxNodes: maxNodes)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
    case "accessibility.hitTest":
      let accessibility = try requireAccessibility()
      // Guest POINTS, not framebuffer ratios: this is the space the tree reports its
      // frames in, so a caller holding a node can hit-test around it directly.
      guard let x = (params["x"] as? NSNumber)?.doubleValue,
        let y = (params["y"] as? NSNumber)?.doubleValue
      else {
        throw RequestError.invalid("accessibility.hitTest.x and .y are required, in guest points.")
      }
      do {
        return try accessibility.hitTest(x: x, y: y)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
    case "accessibility.perform":
      let accessibility = try requireAccessibility()
      guard let action = params["action"] as? String else {
        throw RequestError.invalid("accessibility.perform.action is required.")
      }
      guard let generation = (params["generation"] as? NSNumber)?.intValue,
        let uid = (params["uid"] as? NSNumber)?.intValue
      else {
        throw RequestError.invalid("accessibility.perform.generation and .uid are required.")
      }
      do {
        try accessibility.perform(action: action, generation: generation, uid: uid)
      } catch {
        throw RequestError.unavailable((error as NSError).localizedDescription)
      }
      return ["ok": true]
    default: throw RequestError.invalid("Unknown method \(method).")
    }
  }

  private func ratio(_ params: [String: Any], _ name: String) throws -> Double {
    guard let value = (params[name] as? NSNumber)?.doubleValue, value >= 0, value <= 1 else {
      throw RequestError.invalid("\(name) must be normalized to 0...1.")
    }
    return value
  }

  private func ensureDelivered(_ hid: S1HIDBridge, _ before: Int) throws {
    if hid.failedEventCount > before {
      // Name the guard that rejected it: eleven call sites used to share one
      // message, which made a 50%-failure bug impossible to localise.
      throw RequestError.unavailable(
        "HID event rejected (\(hid.lastFailureReason)).")
    }
  }
}

let developerDirectory = selectedDeveloperDirectory()
do {
  _ = try loadSimulatorFrameworks(
    developerDirectory: developerDirectory, requireSimulatorKit: true)
  setenv("SUPERONE_DEVELOPER_DIR", developerDirectory, 1)
  let session = HelperSession(
    deviceSet: try SimulatorDeviceSet.resolve(developerDirectory: developerDirectory))
  emit(["event": "ready", "protocolVersion": protocolVersion])
  DispatchQueue(label: "app.superone.ios-simulator.control").async {
    while let line = readLine() {
      guard let data = line.data(using: .utf8),
        let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { emit(["id": NSNull(), "ok": false, "error": "Invalid JSON request."]); continue }
      let id = request["id"] ?? NSNull()
      guard let method = request["method"] as? String else {
        emit(["id": id, "ok": false, "error": "Request method is required."])
        continue
      }
      do {
        let result = try session.perform(method: method, params: request["params"] as? [String: Any] ?? [:])
        emit(["id": id, "ok": true, "result": result])
      } catch {
        emit(["id": id, "ok": false, "error": String(describing: error)])
      }
    }
    session.stopStream()
    session.cancelTouch()
    exit(EXIT_SUCCESS)
  }
  RunLoop.main.run()
} catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(EXIT_FAILURE)
}
