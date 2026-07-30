import AppKit

/// One golden scenario for SuperOne Computer Use tools.
protocol LabScenario: AnyObject {
    /// Stable id, e.g. "S03"
    var id: String { get }
    /// Short sidebar title
    var title: String { get }
    /// One-line what this proves
    var summary: String { get }
    /// Tools primarily exercised
    var tools: [String] { get }
    /// delivery modes to prefer
    var deliveries: [String] { get }

    /// Build (or rebuild) the stage content. Caller owns the returned view.
    func makeStage(statusSink: @escaping (String) -> Void) -> NSView

    /// Reset interactive state without tearing down the host chrome.
    func reset()

    /// Extra windows this scenario opened (closed on leave).
    func closeExtras()
}

extension LabScenario {
    func closeExtras() {}
}

struct ScenarioMeta {
    let id: String
    let title: String
    let summary: String
    let tools: [String]
    let deliveries: [String]
}

enum ScenarioCatalog {
    static func all() -> [LabScenario] {
        [
            S01LaunchFocus(),
            S02Snapshot(),
            S03Press(),
            S04TextInput(),
            S05ScrollDrag(),
            S06WaitFor(),
            S07TransientRoots(),
            S08DualWindow(),
            S09Ambiguous(),
            S10StaleRef(),
            S11Coordinate(),
            S12CanvasNoAX(),
            S13PhysicalNoAX(),
        ]
    }
}
