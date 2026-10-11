import ExpoModulesCore

public class VoiceAudioModule: Module {
  private var observers: [NSObjectProtocol] = []
  private var owner: String?
  public func definition() -> ModuleDefinition {
    Name("SuperOneVoiceAudio")
    Events("onInterruption", "onBufferError")
    OnCreate {
      self.observers = [
        NotificationCenter.default.addObserver(forName: .SOVoiceInterrupted, object: nil, queue: nil) { [weak self] _ in if let owner = self?.owner { self?.sendEvent("onInterruption", ["owner": owner, "reason": "interrupted"]) } },
        NotificationCenter.default.addObserver(forName: .SOVoiceBufferError, object: nil, queue: nil) { [weak self] _ in if let owner = self?.owner { self?.sendEvent("onBufferError", ["owner": owner, "message": "Voice pause buffer is full. End this call and start a new one."]) } }
      ]
    }
    AsyncFunction("start") { (id: String) in
      if self.owner != nil && self.owner != id { throw NSError(domain: "SuperOneVoice", code: 2, userInfo: [NSLocalizedDescriptionKey: "Previous voice audio cleanup is pending."]) }
      self.owner = id
      try SOVoiceAudioDevice.shared().beginCall()
    }.runOnQueue(.main)
    AsyncFunction("pause") { (id: String) in if self.owner == id { SOVoiceAudioDevice.shared().pause() } }.runOnQueue(.main)
    AsyncFunction("resume") { (id: String) in
      if self.owner != id { throw NSError(domain: "SuperOneVoice", code: 3, userInfo: [NSLocalizedDescriptionKey: "Voice call is no longer current."]) }
      try SOVoiceAudioDevice.shared().resume()
    }.runOnQueue(.main)
    AsyncFunction("stop") { (id: String) in if self.owner == id { self.owner = nil; SOVoiceAudioDevice.shared().endCall() } }.runOnQueue(.main)
    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.observers = []
      self.owner = nil
      SOVoiceAudioDevice.shared().endCall()
    }
  }
}
