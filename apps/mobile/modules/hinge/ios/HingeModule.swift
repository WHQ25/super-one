import ExpoModulesCore
import UIKit

/// Publishes `UIHinge` status for the key window.
///
/// The interaction is the only public way to read the hinge, and it has to sit
/// on a view in the window. A dev client built without this module simply never
/// emits; JS treats that as an unknown hinge and lays the inner panel out flat.
public class HingeModule: Module {
  private var probe: HingeProbe?

  public func definition() -> ModuleDefinition {
    Name("SuperOneHinge")
    Events("onChange")

    OnStartObserving {
      if self.probe == nil {
        self.probe = HingeProbe { [weak self] body in
          self?.sendEvent("onChange", body)
        }
      }
      self.probe?.start()
    }

    OnStopObserving {
      self.probe?.stop()
    }
  }
}

private final class HingeProbe: NSObject {
  private let emit: ([String: Any]) -> Void
  private var interaction: NSObject?
  private var waiting: NSObjectProtocol?

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emit = emit
  }

  func start() {
    DispatchQueue.main.async { self.attach() }
  }

  func stop() {
    DispatchQueue.main.async { self.detach() }
  }

  private func attach() {
    guard interaction == nil else { return }
    guard #available(iOS 27.1, *) else {
      emit(["status": "unknown"])
      return
    }
    guard let window = Self.keyWindow else {
      waitForWindow()
      return
    }
    let interaction = UIHingeInteraction { [weak self] _, update in
      self?.emit(Self.payload(update.hinge))
    }
    window.addInteraction(interaction)
    self.interaction = interaction
    if let waiting {
      NotificationCenter.default.removeObserver(waiting)
      self.waiting = nil
    }
  }

  private func detach() {
    if let waiting {
      NotificationCenter.default.removeObserver(waiting)
      self.waiting = nil
    }
    guard #available(iOS 27.1, *),
          let interaction = interaction as? UIHingeInteraction,
          let window = Self.keyWindow else {
      interaction = nil
      return
    }
    window.removeInteraction(interaction)
    self.interaction = nil
  }

  private func waitForWindow() {
    guard waiting == nil else { return }
    waiting = NotificationCenter.default.addObserver(
      forName: UIScene.didActivateNotification, object: nil, queue: .main
    ) { [weak self] _ in
      self?.attach()
    }
  }

  @available(iOS 27.1, *)
  private static func payload(_ hinge: UIHinge?) -> [String: Any] {
    guard let hinge else { return ["status": "unknown"] }
    let status: String
    switch hinge.status {
    case .closed: status = "closed"
    case .partiallyOpen: status = "partial"
    case .fullyOpen: status = "flat"
    default: status = "unknown"
    }
    return ["status": status, "radians": hinge.angle]
  }

  private static var keyWindow: UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
  }
}
