/**
 * Computer Use status menu and target-window overlay controller.
 *
 * Cursor geometry, drawing, and motion helpers live in AgentCursorVisuals.swift.
 */

import AppKit
import CoreGraphics
import Foundation
import QuartzCore

struct ControlledTarget {
    let sessionId: String
    let app: String
    let bundleId: String
}

private final class OverlayLocalizer {
    private var localeIdentifier: String
    private var bundle: Bundle

    init() {
        let preferred = Locale.preferredLanguages.first ?? "en"
        localeIdentifier = preferred.lowercased().hasPrefix("zh") ? "zh-Hans" : "en"
        bundle = Self.bundle(for: localeIdentifier)
    }

    @discardableResult
    func setLocale(_ value: String?) -> Bool {
        guard let value else { return false }
        let next = value.lowercased().hasPrefix("zh") ? "zh-Hans" : "en"
        guard next != localeIdentifier else { return false }
        localeIdentifier = next
        bundle = Self.bundle(for: next)
        return true
    }

    func text(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: key, table: nil)
    }

    func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(
            format: text(key),
            locale: Locale(identifier: localeIdentifier),
            arguments: arguments
        )
    }

    private static func bundle(for locale: String) -> Bundle {
        guard let path = Bundle.main.path(forResource: locale, ofType: "lproj"),
              let localized = Bundle(path: path)
        else {
            return .main
        }
        return localized
    }
}

/// `AgentOverlayController` is not an NSObject, so menu items need a separate
/// `@objc` target rather than changing the controller's inheritance.
final class StatusMenuTarget: NSObject, NSMenuDelegate {
    var onStop: (() -> Void)?
    var onMenuOpenChanged: ((Bool) -> Void)?

    @objc func stopCurrentTurn(_ sender: Any?) {
        onStop?()
    }

    func menuWillOpen(_ menu: NSMenu) {
        onMenuOpenChanged?(true)
    }

    func menuDidClose(_ menu: NSMenu) {
        DispatchQueue.main.async { [weak self] in
            self?.onMenuOpenChanged?(false)
        }
    }
}

// MARK: - Controller

/// Not MainActor-isolated: socket handler calls from cooperative pool;
/// all AppKit work is bounced to the main queue.
final class AgentOverlayController {
    static let shared = AgentOverlayController()

    private var enabled = true
    private var statusItem: NSStatusItem?
    private var cursorPanel: NSPanel?
    private var cursorView: AgentCursorView?
    private var hideWorkItem: DispatchWorkItem?
    private var animWorkItem: DispatchWorkItem?
    private var lastAppName: String = ""
    private var lastBundleId: String = ""
    /// Apps under control, pushed by the host via `overlay_set_targets`.
    private var controlledTargets: [ControlledTarget] = []
    private let menuTarget = StatusMenuTarget()
    private let localizer = OverlayLocalizer()
    private var statusMenuOpen = false
    /// Stack virtual cursor with the target window when we know its CGWindowNumber.
    private var anchorWindowId: Int = 0
    private var anchorLayer: Int = 0
    /// Last successfully ordered target (avoid redundant order() calls — OCU).
    private var activeOrderWindowId: Int = 0
    private var activeOrderLayer: Int = 0
    /// Watched target app — hide visuals when it quits (no longer controlling).
    private var watchedBundleId: String = ""
    private var watchedPid: pid_t = 0
    private var appTerminateObserver: NSObjectProtocol?
    /// OCU `displayedTipPosition` — AppKit tip of the software cursor (not HID).
    private var displayedTipAppKit: CGPoint?
    /// Last motion heading in AppKit space for the next path candidate.
    private var lastForward: CGVector = AgentCursorMotion.restingForwardVector()
    private var animGeneration: UInt64 = 0
    /// OCU tip/angle spring state (AppKit tip space).
    private var visualDynamicsState: CursorVisualDynamicsState?
    private var lastClickProgress: CGFloat = 0
    /// Target tip of the in-flight / last hop (AppKit) — used to skip duplicate hops.
    private var pendingTargetAppKit: CGPoint?

    private init() {}

    func setEnabled(_ value: Bool) {
        DispatchQueue.main.async {
            self.enabled = value
            if !value {
                self.hideNow()
            }
        }
    }

    var isEnabled: Bool { enabled }

    /// Show menu-bar chip; optional cursor if coords provided.
    func showTarget(
        quartzBounds: CGRect,
        appName: String,
        windowId: Int?,
        windowLayer: Int?,
        cursorQuartz: CGPoint?,
        pulseRing: Bool
    ) {
        showActive(appName: appName, bundleId: nil, windowId: windowId, windowLayer: windowLayer)
        if let cursorQuartz {
            moveCursor(quartz: cursorQuartz, pulse: pulseRing)
        }
        _ = quartzBounds
    }

    func showActive(
        appName: String,
        bundleId: String?,
        windowId: Int? = nil,
        windowLayer: Int? = nil,
        sessionId: String? = nil,
        locale: String? = nil,
        hideCursor: Bool = false
    ) {
        DispatchQueue.main.async {
            guard self.enabled else { return }
            self.cancelScheduledHide()
            let localeChanged = self.localizer.setLocale(locale)
            self.lastAppName = appName
            if let bundleId, !bundleId.isEmpty {
                self.lastBundleId = bundleId
            }
            self.noteControlledTarget(
                app: appName,
                bundleId: bundleId ?? self.lastBundleId,
                sessionId: sessionId ?? ""
            )
            if let windowId, windowId > 0 {
                self.anchorWindowId = windowId
            }
            if let windowLayer {
                self.anchorLayer = windowLayer
            }
            self.beginWatchingControlTarget(bundleId: self.lastBundleId, pid: nil)
            self.ensureStatusItem()
            if localeChanged {
                self.rebuildStatusMenu()
            }
            self.refreshStatusItem()
            if hideCursor {
                self.hideCursorNow()
            } else {
                // Re-stack the cursor under the newly targeted app window.
                self.configureOrdering(forceReorder: true)
            }
        }
    }

    /// Optional pid when known (list roots / act target) for faster quit detection.
    func setWatchedTarget(bundleId: String?, pid: Int?) {
        DispatchQueue.main.async {
            self.beginWatchingControlTarget(bundleId: bundleId ?? self.lastBundleId, pid: pid)
        }
    }

    /// Move software cursor to a capture/HID (screen-state) point.
    /// Matches OCU: start = last displayed tip, or defaultInitialTipPosition on first show.
    ///
    /// - Parameter wait: When true (action RPCs), block the caller until the hop
    ///   settles so sequential click/moveMouse actually *show* each tip instead of
    ///   cancelling mid-flight and freezing the cursor in one place.
    func moveCursor(quartz: CGPoint, pulse: Bool, wait: Bool = false) {
        if wait && !Thread.isMainThread {
            let sem = DispatchSemaphore(value: 0)
            DispatchQueue.main.async {
                self.moveCursorOnMain(quartz: quartz, pulse: pulse) {
                    sem.signal()
                }
            }
            // Cap wait — hard-snap happens inside on timeout via generation settle.
            _ = sem.wait(timeout: .now() + .milliseconds(1600))
            return
        }
        if Thread.isMainThread {
            moveCursorOnMain(quartz: quartz, pulse: pulse, completion: nil)
        } else {
            DispatchQueue.main.async {
                self.moveCursorOnMain(quartz: quartz, pulse: pulse, completion: nil)
            }
        }
    }

    private func moveCursorOnMain(
        quartz: CGPoint,
        pulse: Bool,
        completion: (() -> Void)?
    ) {
        guard enabled else {
            completion?()
            return
        }
        cancelScheduledHide()
        ensureStatusItem()
        refreshStatusItem()
        ensureCursor()

        let end = AgentCursorMotion.clampTipPosition(screenStatePointToAppKitGlobalPoint(quartz))
        // Skip duplicate hop when adapter + helper both request the same tip.
        if let pending = pendingTargetAppKit,
           hypot(pending.x - end.x, pending.y - end.y) < AgentCursorStyle.snapDistance {
            // Still force the tip onto the target — a cancelled prior hop may have
            // left displayedTip mid-path while pending already matched.
            placeCursorAppKit(end, hardSnap: true)
            displayedTipAppKit = end
            if pulse { cursorView?.pulseClick() }
            completion?()
            return
        }
        moveCursorAppKit(to: end, pulseAtEnd: pulse, completion: completion)
    }

    /// Snap along densified HID path (screen-state points). No path re-plan —
    /// caller already densified; only visual dynamics lag/rotation apply.
    func placeCursorImmediate(quartz: CGPoint, pulse: Bool = false) {
        DispatchQueue.main.async {
            guard self.enabled else { return }
            self.cancelScheduledHide()
            // Do not cancelAnimation here mid-drag — drag owns timing via densify.
            self.ensureStatusItem()
            self.refreshStatusItem()
            self.ensureCursor()
            let tip = AgentCursorMotion.clampTipPosition(screenStatePointToAppKitGlobalPoint(quartz))
            if let prev = self.displayedTipAppKit {
                let d = CGVector(dx: tip.x - prev.x, dy: tip.y - prev.y)
                let len = hypot(d.dx, d.dy)
                if len > 1e-3 {
                    self.lastForward = CGVector(dx: d.dx / len, dy: d.dy / len)
                }
            }
            self.placeCursorAppKit(tip, hardSnap: false)
            self.pendingTargetAppKit = tip
            if pulse { self.cursorView?.pulseClick() }
        }
    }

    /// Multi-waypoint path in screen-state coords (converted to AppKit for motion).
    func animateCursor(along quartzPoints: [CGPoint], durationMs: Int) {
        DispatchQueue.main.async {
            guard self.enabled, quartzPoints.count >= 2 else { return }
            self.cancelScheduledHide()
            self.ensureStatusItem()
            self.refreshStatusItem()
            self.ensureCursor()
            _ = durationMs

            let appKitPoints = quartzPoints.map {
                AgentCursorMotion.clampTipPosition(screenStatePointToAppKitGlobalPoint($0))
            }
            let samples = AgentCursorMotion.springSamplesAlong(appKitPoints)
            guard samples.count >= 2 else {
                if let p = samples.first {
                    self.placeCursorAppKit(p, hardSnap: true)
                    self.pendingTargetAppKit = p
                }
                return
            }
            self.playSampledPathAppKit(samples, pulseAtEnd: true)
        }
    }

    // MARK: Spring motion (main-queue, AppKit tip space — OCU)

    /// - Parameter snapToPending: complete the in-flight hop instantly so the tip
    ///   never freezes mid-path when a new hop or screenshot interrupt arrives.
    private func cancelAnimation(snapToPending: Bool = false) {
        animWorkItem?.cancel()
        animWorkItem = nil
        animGeneration &+= 1
        if snapToPending, let pending = pendingTargetAppKit {
            placeCursorAppKit(pending, hardSnap: true)
            displayedTipAppKit = pending
        }
    }

    /// Move the software tip from its last position to `end`.
    ///
    /// Do **not** tour through OCU `defaultInitialTipPosition` (tipAnchor near the
    /// primary display's bottom-left). That made every "fresh" hop look like:
    /// current control → corner → next control.
    private func moveCursorAppKit(
        to end: CGPoint,
        pulseAtEnd: Bool,
        completion: (() -> Void)? = nil
    ) {
        // Finish prior hop first — sequential act steps cancel each other otherwise.
        cancelAnimation(snapToPending: true)
        let generation = animGeneration
        pendingTargetAppKit = end

        // First appearance in this control session: materialize on the target
        // (no scenic entrance from the screen corner).
        guard let start = displayedTipAppKit else {
            let now = CACurrentMediaTime()
            visualDynamicsState = CursorVisualDynamicsAnimator.state(
                at: end,
                time: CGFloat(now)
            )
            placeCursorAppKit(end, hardSnap: true)
            displayedTipAppKit = end
            if pulseAtEnd { cursorView?.pulseClick() }
            completion?()
            return
        }

        placeCursorAppKit(start, hardSnap: false)

        let dist = hypot(end.x - start.x, end.y - start.y)
        if dist <= 2 {
            placeCursorAppKit(end, hardSnap: true)
            displayedTipAppKit = end
            pendingTargetAppKit = end
            if pulseAtEnd { cursorView?.pulseClick() }
            completion?()
            return
        }

        runSpringMotionAppKit(
            from: start,
            to: end,
            startForward: lastForward,
            pulseAtEnd: pulseAtEnd,
            generation: generation,
            completion: completion
        )
    }

    private func runSpringMotionAppKit(
        from start: CGPoint,
        to end: CGPoint,
        startForward: CGVector?,
        pulseAtEnd: Bool,
        generation: UInt64,
        completion: (() -> Void)? = nil
    ) {
        // Keep OCU heading-driven curves; only the tipAnchor entrance was wrong.
        let candidate = AgentCursorMotion.chooseCandidate(
            from: start,
            to: end,
            startForward: startForward
        )
        // Cap travel so sequential actions remain watchable (~0.35s max hop).
        let natural = AgentCursorMotion.travelDuration(for: candidate, from: start, to: end)
        let duration = min(max(natural, 0.08), 0.35)
        let springTarget = OfficialCursorMotionModel.closeEnoughTime
        let startTime = CACurrentMediaTime()
        var progress: CGFloat = 0
        var springState = CursorMotionSpringState()

        func finish() {
            self.placeCursorAppKit(end, hardSnap: true)
            self.displayedTipAppKit = end
            self.pendingTargetAppKit = end
            if pulseAtEnd { self.cursorView?.pulseClick() }
            self.animWorkItem = nil
            completion?()
        }

        func tick() {
            guard self.enabled, generation == self.animGeneration else {
                // Superseded — completion is owned by the newer hop.
                return
            }
            let elapsed = CGFloat(CACurrentMediaTime() - startTime)
            let normalizedElapsed = min(elapsed / max(duration, 0.001), 1)
            let springTime = normalizedElapsed * springTarget
            (progress, springState) = CursorMotionProgressAnimator.advance(
                current: progress,
                state: springState,
                to: springTime
            )
            let sample = candidate.path.sample(at: min(max(progress, 0), 1))
            // Path sample = dynamics *target*; tip lag is inside placeCursorAppKit.
            self.placeCursorAppKit(sample.point, hardSnap: false)
            let tan = sample.tangent
            let tlen = hypot(tan.dx, tan.dy)
            if tlen > 1e-3 {
                self.lastForward = CGVector(dx: tan.dx / tlen, dy: tan.dy / tlen)
            }

            if normalizedElapsed >= 1 || CursorMotionProgressAnimator.isCloseEnough(progress: progress) {
                finish()
                return
            }

            let work = DispatchWorkItem { tick() }
            self.animWorkItem = work
            DispatchQueue.main.asyncAfter(
                deadline: .now() + .milliseconds(AgentCursorStyle.frameMs),
                execute: work
            )
        }

        let work = DispatchWorkItem { tick() }
        animWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(AgentCursorStyle.frameMs),
            execute: work
        )
    }

    private func playSampledPathAppKit(_ samples: [CGPoint], pulseAtEnd: Bool) {
        cancelAnimation()
        let generation = animGeneration
        pendingTargetAppKit = samples.last
        placeCursorAppKit(samples[0], hardSnap: displayedTipAppKit == nil)

        var index = 1
        func step() {
            guard self.enabled, generation == self.animGeneration else { return }
            guard index < samples.count else {
                if let last = samples.last {
                    self.displayedTipAppKit = last
                    self.pendingTargetAppKit = last
                }
                if pulseAtEnd { self.cursorView?.pulseClick() }
                self.animWorkItem = nil
                return
            }
            let p = samples[index]
            if index > 0 {
                let prev = samples[index - 1]
                let d = CGVector(dx: p.x - prev.x, dy: p.y - prev.y)
                let len = hypot(d.dx, d.dy)
                if len > 1e-3 {
                    self.lastForward = CGVector(dx: d.dx / len, dy: d.dy / len)
                }
            }
            self.placeCursorAppKit(p, hardSnap: false)
            index += 1
            if index < samples.count {
                let work = DispatchWorkItem { step() }
                self.animWorkItem = work
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + .milliseconds(AgentCursorStyle.frameMs),
                    execute: work
                )
            } else {
                if let last = samples.last {
                    self.displayedTipAppKit = last
                    self.pendingTargetAppKit = last
                }
                if pulseAtEnd { self.cursorView?.pulseClick() }
                self.animWorkItem = nil
            }
        }

        let work = DispatchWorkItem { step() }
        animWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(AgentCursorStyle.frameMs),
            execute: work
        )
    }

    /// Full teardown (status chip + cursor). Host calls this on turn end /
    /// interrupt / dispose — not after each action.
    func scheduleHide(afterMs: Int = 1600) {
        DispatchQueue.main.async {
            self.cancelScheduledHide()
            let work = DispatchWorkItem { [weak self] in
                self?.hideNow()
            }
            self.hideWorkItem = work
            DispatchQueue.main.asyncAfter(
                deadline: .now() + .milliseconds(max(0, afterMs)),
                execute: work
            )
        }
    }

    func hideImmediately() {
        DispatchQueue.main.async {
            self.cancelScheduledHide()
            self.animWorkItem?.cancel()
            self.animWorkItem = nil
            self.hideNow()
        }
    }

    /// Temporarily hide the software cursor for a screenshot without losing tip
    /// state, so the hop continues after capture. Status chip stays up.
    /// - Parameter suspended: true = orderOut for capture; false = restore tip.
    func setCursorSuspended(_ suspended: Bool) {
        DispatchQueue.main.async {
            guard self.enabled else { return }
            self.cancelScheduledHide()
            if suspended {
                // Finish any in-flight hop first — otherwise capture-hide freezes
                // the tip mid-path and the next act looks "stuck in one place".
                self.cancelAnimation(snapToPending: true)
                self.cursorPanel?.orderOut(nil)
            } else if let tip = self.pendingTargetAppKit ?? self.displayedTipAppKit {
                self.ensureCursor()
                self.placeCursorAppKit(tip, hardSnap: true)
                self.displayedTipAppKit = tip
            }
        }
    }

    // MARK: - Private

    private func cancelScheduledHide() {
        hideWorkItem?.cancel()
        hideWorkItem = nil
    }

    /// Place panel via OCU visual dynamics. `tipAppKit` is AppKit global tip position.
    private func placeCursorAppKit(_ tipAppKit: CGPoint, hardSnap: Bool) {
        let target = AgentCursorMotion.clampTipPosition(tipAppKit)
        let now = CGFloat(CACurrentMediaTime())
        let click = cursorView?.clickProgress ?? lastClickProgress

        if hardSnap || visualDynamicsState == nil {
            visualDynamicsState = CursorVisualDynamicsAnimator.state(
                at: target,
                time: now
            )
        }

        let result = CursorVisualDynamicsAnimator.advance(
            state: visualDynamicsState
                ?? CursorVisualDynamicsAnimator.state(at: target, time: now),
            targetTipPosition: target,
            targetTime: now,
            idleAngleOffset: 0,
            baseHeading: AgentCursorStyle.artworkNeutralHeading,
            renderYAxisMultiplier: AgentCursorStyle.renderYAxisMultiplier
        )
        visualDynamicsState = result.state
        let render = result.renderState

        // OCU: origin = tip - tipAnchor (AppKit y-up).
        let size = AgentCursorStyle.windowSize
        let tip = AgentCursorStyle.tipAnchor
        let frame = NSRect(
            x: render.tipPosition.x - tip.x,
            y: render.tipPosition.y - tip.y,
            width: size.width,
            height: size.height
        )
        guard let panel = cursorPanel else { return }
        panel.setFrame(frame, display: true)
        cursorView?.apply(renderState: render, clickProgress: click)
        lastClickProgress = click
        // Track *path target* tip for next hop start (OCU displayedTipPosition after settle
        // uses dynamics tip; mid-flight we still update so cancel/resume stays coherent).
        displayedTipAppKit = render.tipPosition
        if let state = visualDynamicsState {
            let v = state.tipVelocity
            let len = hypot(v.dx, v.dy)
            if len > 14 {
                lastForward = CGVector(dx: v.dx / len, dy: v.dy / len)
            }
        }
        configureOrdering(forceReorder: false)
    }

    private func hideNow() {
        stopWatchingControlTarget()
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
        }
        statusItem = nil
        statusMenuOpen = false
        hideCursorNow()
        anchorWindowId = 0
        anchorLayer = 0
        lastAppName = ""
        lastBundleId = ""
        // Control is over — the menu must not keep listing apps as controlled.
        controlledTargets = []
    }

    /// Fully clear the software pointer (and tip state). Used when control ends
    /// or the host explicitly wants no cursor — not for screenshot suspend.
    private func hideCursorNow() {
        // Drop tip state — do not snap-to-pending (control is ending).
        cancelAnimation(snapToPending: false)
        cursorPanel?.orderOut(nil)
        // Reset so the next explicit action starts from the standard initial position.
        displayedTipAppKit = nil
        pendingTargetAppKit = nil
        lastForward = AgentCursorMotion.restingForwardVector()
        visualDynamicsState = nil
        lastClickProgress = 0
        activeOrderWindowId = 0
        activeOrderLayer = 0
    }

    // MARK: Control-target lifecycle (app quit only — no window poll)

    /// While the chip/cursor is up, hide when the *target app process* quits.
    /// We intentionally do not poll for CGWindow disappearance.
    private func beginWatchingControlTarget(bundleId: String, pid: Int?) {
        watchedBundleId = bundleId
        watchedPid = pid_t(pid ?? 0)

        if appTerminateObserver == nil {
            appTerminateObserver = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didTerminateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let self else { return }
                let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
                let bid = app?.bundleIdentifier ?? ""
                let pid = app?.processIdentifier ?? 0
                let matchBundle = !self.watchedBundleId.isEmpty
                    && !bid.isEmpty
                    && bid.caseInsensitiveCompare(self.watchedBundleId) == .orderedSame
                let matchPid = self.watchedPid != 0 && pid == self.watchedPid
                if matchBundle || matchPid {
                    self.hideNow()
                }
            }
        }
    }

    private func stopWatchingControlTarget() {
        if let obs = appTerminateObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
            appTerminateObserver = nil
        }
        watchedBundleId = ""
        watchedPid = 0
    }

    // MARK: Status item — OCU software cursor + ringed app (active control)

    private func ensureStatusItem() {
        if statusItem != nil { return }
        // First show of a control session — pick this session's cursor colour.
        // `hideNow()` clears statusItem, so the next session rolls a new one.
        AgentCursorTint.roll()
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.isVisible = true
        if let button = item.button {
            button.imagePosition = .imageOnly
            button.isEnabled = true
        }
        menuTarget.onStop = { [weak self] in
            self?.requestStopCurrentTurn()
        }
        menuTarget.onMenuOpenChanged = { [weak self] isOpen in
            guard let self else { return }
            self.statusMenuOpen = isOpen
            self.refreshStatusItem()
        }
        statusItem = item
        rebuildStatusMenu()
    }

    /// Ask the host to interrupt the turn that is driving Computer Use.
    ///
    /// Deliberately does **not** hide the overlay here: the visuals must keep
    /// reflecting reality until the host actually stops issuing commands.
    /// Hiding early would tell the user it stopped while the agent still clicks.
    private func requestStopCurrentTurn() {
        let sessionIds = controlledTargets.map(\.sessionId)
        HelperEventBus.shared.emit("computer_use_stop_requested", [
            "scope": "current_turn",
            "sessionIds": Array(Set(sessionIds)),
        ])
    }

    /// Accumulate the app the host just targeted. Must be called on the main queue.
    /// Keyed by session + bundle so the same app driven by two sessions lists twice.
    private func noteControlledTarget(app: String, bundleId: String, sessionId: String) {
        guard !app.isEmpty || !bundleId.isEmpty else { return }
        let existing = controlledTargets.firstIndex {
            $0.sessionId == sessionId && $0.bundleId == bundleId
        }
        if let existing {
            // App name can arrive empty on some calls; keep the better one.
            if controlledTargets[existing].app.isEmpty && !app.isEmpty {
                controlledTargets[existing] = ControlledTarget(
                    sessionId: sessionId, app: app, bundleId: bundleId
                )
                rebuildStatusMenu()
            }
            return
        }
        controlledTargets.append(
            ControlledTarget(sessionId: sessionId, app: app, bundleId: bundleId)
        )
        rebuildStatusMenu()
    }

    private func rebuildStatusMenu() {
        guard let item = statusItem else { return }
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = menuTarget

        if controlledTargets.isEmpty {
            let empty = NSMenuItem(
                title: localizer.text("status.menu.empty"),
                action: nil,
                keyEquivalent: ""
            )
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            let header = NSMenuItem(
                title: localizer.text("status.menu.header"),
                action: nil,
                keyEquivalent: ""
            )
            header.isEnabled = false
            menu.addItem(header)
            for target in controlledTargets {
                let row = NSMenuItem(title: target.app, action: nil, keyEquivalent: "")
                row.isEnabled = false
                row.indentationLevel = 1
                // Keep the target recognisable in both the status group and menu.
                let icon = appIconImage(appName: target.app, bundleId: target.bundleId)
                icon.size = NSSize(width: 16, height: 16)
                row.image = icon
                menu.addItem(row)
            }
        }

        menu.addItem(.separator())
        let stop = NSMenuItem(
            title: localizer.text("status.menu.stop"),
            action: #selector(StatusMenuTarget.stopCurrentTurn(_:)),
            keyEquivalent: ""
        )
        stop.target = menuTarget
        stop.isEnabled = !controlledTargets.isEmpty
        menu.addItem(stop)

        item.menu = menu
    }

    private func refreshStatusItem() {
        guard let button = statusItem?.button else { return }
        let image = statusItemImage(drawGroupBackground: !statusMenuOpen && !button.isHighlighted)
        image.accessibilityDescription = statusSummary()
        button.image = image
        button.toolTip = statusSummary()
        button.appearsDisabled = false
    }

    private func statusSummary() -> String {
        switch controlledTargets.count {
        case 0:
            guard !lastAppName.isEmpty else {
                return localizer.text("status.summary.generic")
            }
            return localizer.format("status.summary.single", lastAppName)
        case 1:
            return localizer.format("status.summary.single", controlledTargets[0].app)
        default:
            return localizer.format("status.summary.multiple", controlledTargets.count)
        }
    }

    /// Menu-bar group: software cursor + current app icon on one borderless surface.
    private func statusItemImage(drawGroupBackground: Bool) -> NSImage {
        let cursorSize = AgentCursorGlyph.badgeSize
        let cursorProbe = AgentCursorGlyph.path(size: cursorSize, tip: .zero).bounds
        let height = NSStatusBar.system.thickness
        let groupHeight = min(22, height - 2)
        let appSize: CGFloat = 18
        let horizontalPadding: CGFloat = 5
        let iconGap: CGFloat = 4
        let width = ceil(horizontalPadding * 2 + cursorProbe.width + iconGap + appSize)

        let target = controlledTargets.last
        let appName = lastAppName.isEmpty ? (target?.app ?? "") : lastAppName
        let bundleId = lastBundleId.isEmpty ? (target?.bundleId ?? "") : lastBundleId
        let appIcon = appIconImage(appName: appName, bundleId: bundleId)

        let image = NSImage(size: NSSize(width: width, height: height), flipped: false) { rect in
            let groupRect = NSRect(
                x: 0,
                y: rect.midY - groupHeight / 2,
                width: rect.width,
                height: groupHeight
            )
            if drawGroupBackground {
                NSColor.labelColor.withAlphaComponent(0.11).setFill()
                NSBezierPath(roundedRect: groupRect, xRadius: 6, yRadius: 6).fill()
            }

            let appRect = NSRect(
                x: horizontalPadding,
                y: rect.midY - appSize / 2,
                width: appSize,
                height: appSize
            )
            appIcon.draw(in: appRect)

            let cursorCenterX = horizontalPadding + appSize + iconGap + cursorProbe.width / 2
            let path = AgentCursorGlyph.path(
                size: cursorSize,
                tip: CGPoint(
                    x: cursorCenterX - cursorProbe.midX,
                    y: rect.midY - cursorProbe.midY
                )
            )
            // Widen slightly: without the white keyline and gradient of the
            // overlay version, a bare fill reads thinner than it measures.
            path.lineJoinStyle = .round
            path.lineWidth = cursorSize * 0.06
            NSColor.labelColor.setFill()
            NSColor.labelColor.setStroke()
            path.fill()
            path.stroke()
            return true
        }
        image.isTemplate = false
        return image
    }

    private func appIconImage(appName: String, bundleId: String) -> NSImage {
        if !bundleId.isEmpty,
           let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
            let icon = NSWorkspace.shared.icon(forFile: url.path)
            icon.size = NSSize(width: 32, height: 32)
            return icon
        }
        if let running = NSWorkspace.shared.runningApplications.first(where: {
            $0.localizedName?.caseInsensitiveCompare(appName) == .orderedSame
                || $0.bundleIdentifier?.caseInsensitiveCompare(appName) == .orderedSame
        }), let bid = running.bundleIdentifier,
           let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) {
            let icon = NSWorkspace.shared.icon(forFile: url.path)
            icon.size = NSSize(width: 32, height: 32)
            return icon
        }
        let fallback = NSImage(systemSymbolName: "app.fill", accessibilityDescription: appName)
            ?? NSImage(size: NSSize(width: 32, height: 32))
        fallback.size = NSSize(width: 32, height: 32)
        return fallback
    }

    // MARK: Virtual cursor panel

    private func ensureCursor() {
        if cursorPanel != nil { return }
        let size = AgentCursorStyle.windowSize
        let view = AgentCursorView(frame: NSRect(origin: .zero, size: size))
        // Drawing is via draw(_:) — do not set wantsLayer alone without a drawn layer.
        view.wantsLayer = false
        // OCU: nonactivating panel at the *target window's* level — not screenSaver.
        // Floating above every app would cover SuperOne / the user's frontmost app.
        let panel = CursorPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = false
        panel.level = .normal
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .ignoresCycle,
            .stationary,
        ]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // Official artwork already includes soft fog/shadow; avoid double shadow.
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.contentView = view
        panel.isExcludedFromWindowsMenu = true
        panel.alphaValue = 1.0
        panel.animationBehavior = .none
        cursorView = view
        cursorPanel = panel
    }

    /// OCU `configureOrdering`: stack the software cursor with the *target* app
    /// window (same CGWindow layer + order above that window number only).
    /// Does not use `.screenSaver` / `orderFrontRegardless`, so other apps
    /// (including SuperOne) stay above the cursor when they are frontmost.
    private func configureOrdering(forceReorder: Bool) {
        guard let panel = cursorPanel else { return }

        let targetId = anchorWindowId
        let targetLayer = anchorLayer
        let present = targetId > 0 && isCGWindowPresent(CGWindowID(targetId))
        let effectiveId = present ? targetId : 0
        let effectiveLayer = present ? targetLayer : 0

        let desiredLevel = NSWindow.Level(rawValue: effectiveLayer)
        if panel.level != desiredLevel {
            panel.level = desiredLevel
        }

        let needReorder = forceReorder
            || activeOrderWindowId != effectiveId
            || activeOrderLayer != effectiveLayer
            || !panel.isVisible

        if needReorder {
            if effectiveId > 0 {
                // Sit just above the target CGWindow — not above every process.
                panel.order(.above, relativeTo: effectiveId)
            } else {
                // No window id: normal level front of our own process only.
                panel.orderFront(nil)
            }
            activeOrderWindowId = effectiveId
            activeOrderLayer = effectiveLayer
        }
        cursorView?.needsDisplay = true
    }

    private func isCGWindowPresent(_ windowID: CGWindowID) -> Bool {
        guard windowID != 0,
              let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]],
              !info.isEmpty
        else {
            return false
        }
        return true
    }
}

/// Non-activating panel that never steals key focus (OCU CursorPanel).
private final class CursorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
