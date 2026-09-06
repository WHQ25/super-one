import ExpoModulesCore
import Network

/**
 Browses Bonjour for SuperOne desktops advertising on this network.

 `NWBrowser` hands back the TXT record without any extra round trip, which is
 what carries the room id the JS side matches against a saved pairing. The host
 and port still need resolving, and the documented way to do that with Network.framework
 is to open a connection to the service endpoint and read the resolved remote
 endpoint off its path — so each discovered service gets one short-lived probe.
 */
public class LanBrowserModule: Module {
  private let queue = DispatchQueue(label: "dev.superone.lan-browser")
  private var browser: NWBrowser?
  /// Bonjour instance name → the record published to JS.
  private var records: [String: [String: Any]] = [:]
  private var resolvers: [String: NWConnection] = [:]

  public func definition() -> ModuleDefinition {
    Name("SuperOneLanBrowser")
    Events("onServicesChanged")

    AsyncFunction("start") { (serviceType: String, promise: Promise) in
      self.queue.async {
        if self.browser != nil {
          promise.resolve(nil)
          return
        }
        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(type: serviceType, domain: nil)
        let browser = NWBrowser(for: descriptor, using: parameters)

        browser.stateUpdateHandler = { state in
          switch state {
          case .ready:
            promise.resolve(nil)
          case .failed(let error):
            self.queue.async { self.teardown() }
            promise.reject("ERR_LAN_BROWSER", "Bonjour browse failed: \(error.localizedDescription)")
          default:
            break
          }
        }
        browser.browseResultsChangedHandler = { results, _ in
          self.queue.async { self.apply(results: results) }
        }
        self.browser = browser
        browser.start(queue: self.queue)
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.queue.async {
        self.teardown()
        promise.resolve(nil)
      }
    }

    OnDestroy {
      self.queue.sync { self.teardown() }
    }
  }

  private func teardown() {
    browser?.cancel()
    browser = nil
    for resolver in resolvers.values { resolver.cancel() }
    resolvers.removeAll()
    records.removeAll()
  }

  private func apply(results: Set<NWBrowser.Result>) {
    var seen = Set<String>()
    for result in results {
      guard case let .service(name, _, _, _) = result.endpoint else { continue }
      seen.insert(name)
      let txt = Self.txtDictionary(result.metadata)
      if var existing = records[name] {
        // A TXT change on an already-resolved service keeps its address.
        existing["txt"] = txt
        records[name] = existing
      } else {
        records[name] = ["txt": txt, "port": NSNull(), "host": NSNull(), "addresses": [String]()]
        resolve(endpoint: result.endpoint, name: name)
      }
    }
    for name in records.keys where !seen.contains(name) {
      records.removeValue(forKey: name)
      resolvers.removeValue(forKey: name)?.cancel()
    }
    publish()
  }

  private func resolve(endpoint: NWEndpoint, name: String) {
    resolvers[name]?.cancel()
    let connection = NWConnection(to: endpoint, using: .tcp)
    resolvers[name] = connection
    connection.stateUpdateHandler = { [weak connection] state in
      switch state {
      case .ready:
        guard let remote = connection?.currentPath?.remoteEndpoint,
              case let .hostPort(host, port) = remote else { return }
        self.queue.async {
          guard var record = self.records[name] else { return }
          let address = Self.describe(host: host)
          record["host"] = address
          record["addresses"] = [address]
          record["port"] = Int(port.rawValue)
          self.records[name] = record
          self.resolvers.removeValue(forKey: name)?.cancel()
          self.publish()
        }
      case .failed, .cancelled:
        self.queue.async { self.resolvers.removeValue(forKey: name) }
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  /// Only services that resolved are worth publishing; the rest are still in flight.
  private func publish() {
    let services = records.values.filter { !($0["port"] is NSNull) }
    sendEvent("onServicesChanged", ["services": Array(services)])
  }

  private static func txtDictionary(_ metadata: NWBrowser.Result.Metadata) -> [String: String] {
    guard case let .bonjour(record) = metadata else { return [:] }
    return record.dictionary
  }

  /// `NWEndpoint.Host` renders link-local IPv6 with a `%en0` zone; JS wants the bare address.
  private static func describe(host: NWEndpoint.Host) -> String {
    let raw: String
    switch host {
    case .ipv4(let address): raw = "\(address)"
    case .ipv6(let address): raw = "\(address)"
    case .name(let name, _): raw = name
    @unknown default: raw = "\(host)"
    }
    return raw.components(separatedBy: "%").first ?? raw
  }
}
