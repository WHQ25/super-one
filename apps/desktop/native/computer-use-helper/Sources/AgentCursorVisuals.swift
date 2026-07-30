/**
 * Computer Use visual indicators (macOS).
 *
 * 1. Menu-bar status chip (Codex-style): [app icon] + [mouse glyph]
 * 2. On-screen virtual cursor (software pointer, not the hardware cursor)
 *    — click-through (`ignoresMouseEvents`), non-activating, no focus steal
 *    — Procedural glyph (AgentCursorGlyph), tinted per control session
 *    — tipAnchor + 126pt window match OCU GlyphMetrics
 *    — OCU heading-driven cubic path + official progress spring (CursorMotionModel)
 *    — OCU visual dynamics: tip spring lag, heading rotation, body/fog offsets
 *    — OCU z-order: same window level as target app + order(.above, relativeTo: windowId)
 *    — Visibility policy (host-driven): stay painted for the whole control turn;
 *      suspend only around screenshots; full hide on turn end / interrupt
 *
 * Does NOT move the system pointer unless the helper posts global HID separately.
 *
 * Asset / motion attribution: open-computer-use (MIT License, Copyright 2026 Leo).
 * See Resources/NOTICE.md.
 */

import AppKit
import CoreGraphics
import Foundation
import QuartzCore

// MARK: - Geometry (match OCU screen-state ↔ AppKit)

/// Quartz / CGWindowList / CGEvent / AX position space: y-down, global via
/// `CGDisplayBounds` (same as OCU "screen state").
/// AppKit window frames: y-up, `NSScreen.frame`.
///
/// Conversion mirrors open-computer-use `screenStatePointToAppKitGlobalPoint`.

struct VisualCursorScreenMapping: Equatable {
    let screenStateFrame: CGRect
    let appKitFrame: CGRect
}

func currentVisualCursorScreenMappings() -> [VisualCursorScreenMapping] {
    NSScreen.screens.compactMap { screen in
        guard let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }
        return VisualCursorScreenMapping(
            screenStateFrame: CGDisplayBounds(CGDirectDisplayID(screenNumber.uint32Value)),
            appKitFrame: screen.frame
        )
    }
}

/// OCU `screenStatePointToAppKitGlobalPoint` — HID/capture coords → panel tip coords.
func screenStatePointToAppKitGlobalPoint(
    _ point: CGPoint,
    screenMappings: [VisualCursorScreenMapping] = currentVisualCursorScreenMappings()
) -> CGPoint {
    guard let mapping = screenMappings.first(where: { $0.screenStateFrame.contains(point) }) else {
        // Fallback: primary display flip (legacy). Prefer mapping when available.
        let primary = NSScreen.screens.first(where: { $0.frame.origin == .zero })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        let h = primary?.frame.height ?? 900
        let ox = primary?.frame.minX ?? 0
        let oy = primary?.frame.minY ?? 0
        return CGPoint(x: ox + point.x, y: oy + h - point.y)
    }
    let localX = point.x - mapping.screenStateFrame.minX
    let localY = point.y - mapping.screenStateFrame.minY
    return CGPoint(
        x: mapping.appKitFrame.minX + localX,
        y: mapping.appKitFrame.maxY - localY
    )
}

func appKitGlobalPointToScreenState(
    _ point: CGPoint,
    screenMappings: [VisualCursorScreenMapping] = currentVisualCursorScreenMappings()
) -> CGPoint {
    guard let mapping = screenMappings.first(where: { $0.appKitFrame.contains(point) }) else {
        let primary = NSScreen.screens.first(where: { $0.frame.origin == .zero })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        let h = primary?.frame.height ?? 900
        let ox = primary?.frame.minX ?? 0
        let oy = primary?.frame.minY ?? 0
        return CGPoint(x: point.x - ox, y: h - (point.y - oy))
    }
    let localX = point.x - mapping.appKitFrame.minX
    let localY = mapping.appKitFrame.maxY - point.y
    return CGPoint(
        x: mapping.screenStateFrame.minX + localX,
        y: mapping.screenStateFrame.minY + localY
    )
}

/// Back-compat aliases used by older call sites / tests.
func cocoaPointFromQuartz(_ point: CGPoint) -> NSPoint {
    let p = screenStatePointToAppKitGlobalPoint(point)
    return NSPoint(x: p.x, y: p.y)
}

func quartzPointFromCocoa(_ point: NSPoint) -> CGPoint {
    appKitGlobalPointToScreenState(CGPoint(x: point.x, y: point.y))
}

// MARK: - OCU software-cursor metrics (open-computer-use MIT)

/// Matches `SoftwareCursorGlyphMetrics` from open-computer-use.
enum AgentCursorStyle {
    /// Logical window size in points.
    static let windowSize = CGSize(width: 126, height: 126)
    /// Hotspot of the pointer tip inside the 126×126 window (AppKit y-up).
    static let tipAnchor = CGPoint(x: 60.35, y: 70.3)
    /// Artwork neutral heading (radians); matches OCU targetNeutralHeading.
    static let artworkNeutralHeading: CGFloat = -(3 * .pi / 4)
    /// OCU `visualCursorRuntimeRenderYAxisMultiplier` — AppKit tips, y-down glyph state.
    static let renderYAxisMultiplier: CGFloat = -1
    /// Teleport instead of spring when tip is already this close (quartz pt).
    static let snapDistance: CGFloat = 4
    /// Async animation frame period.
    static let frameMs: Int = 8
}

// MARK: - Motion sampling (shared by overlay + HID drag densify)

/// Path motion in **AppKit** tip space (same as OCU SoftwareCursorOverlay).
enum AgentCursorMotion {
    /// Resting forward (OCU `visualCursorAppKitForwardHeading(renderRotation: 0)`).
    static func restingForwardVector() -> CGVector {
        let angle = -AgentCursorStyle.artworkNeutralHeading
        return CGVector(dx: cos(angle), dy: sin(angle))
    }

    /// OCU first-paint tip: windowOrigin.zero + tipAnchor → near primary bottom-left.
    static func defaultInitialTipPosition() -> CGPoint {
        AgentCursorStyle.tipAnchor
    }

    static func chooseCandidate(
        from start: CGPoint,
        to end: CGPoint,
        startForward: CGVector? = nil
    ) -> CursorMotionCandidate {
        let bounds = motionBounds(from: start, to: end)
        let sf = startForward ?? restingForwardVector()
        let ef = restingForwardVector()
        let candidates = HeadingDrivenCursorMotionModel.makeCandidates(
            start: start,
            end: end,
            bounds: bounds,
            startForward: sf,
            endForward: ef
        )
        if let best = HeadingDrivenCursorMotionModel.chooseBestCandidate(from: candidates) {
            return best
        }
        let path = CursorMotionPath(start: start, end: end)
        return CursorMotionCandidate(
            identifier: "linear-fallback",
            kind: .base,
            side: 0,
            tableAScale: nil,
            tableBScale: nil,
            path: path,
            measurement: path.measure(bounds: bounds),
            score: 0
        )
    }

    static func travelDuration(for candidate: CursorMotionCandidate, from start: CGPoint, to end: CGPoint) -> CGFloat {
        OfficialCursorMotionModel.calibratedTravelDuration(
            distance: hypot(end.x - start.x, end.y - start.y),
            measurement: candidate.measurement
        )
    }

    /// Spring samples in the **same space as start/end** (AppKit for overlay; screen-state for HID densify).
    static func springSamples(
        from start: CGPoint,
        to end: CGPoint,
        startForward: CGVector? = nil,
        frameDt: CGFloat = 1.0 / 120.0
    ) -> [CGPoint] {
        let dist = hypot(end.x - start.x, end.y - start.y)
        if dist < AgentCursorStyle.snapDistance {
            return [start, end]
        }
        let candidate = chooseCandidate(from: start, to: end, startForward: startForward)
        let duration = travelDuration(for: candidate, from: start, to: end)
        let springTarget = OfficialCursorMotionModel.closeEnoughTime
        var progress: CGFloat = 0
        var state = CursorMotionSpringState()
        var samples: [CGPoint] = [start]
        var t: CGFloat = 0
        let maxSteps = 4096
        var steps = 0
        while steps < maxSteps {
            steps += 1
            t += frameDt
            let normalized = min(t / max(duration, 0.001), 1)
            let springTime = normalized * springTarget
            (progress, state) = CursorMotionProgressAnimator.advance(
                current: progress,
                state: state,
                to: springTime
            )
            let sample = candidate.path.sample(at: min(max(progress, 0), 1)).point
            if let last = samples.last {
                if hypot(sample.x - last.x, sample.y - last.y) >= 0.45 {
                    samples.append(sample)
                }
            } else {
                samples.append(sample)
            }
            if normalized >= 1 || CursorMotionProgressAnimator.isCloseEnough(progress: progress) {
                break
            }
        }
        if let last = samples.last, hypot(last.x - end.x, last.y - end.y) > 0.5 {
            samples.append(end)
        } else if samples.isEmpty {
            samples = [start, end]
        }
        return samples
    }

    static func springSamplesAlong(_ waypoints: [CGPoint]) -> [CGPoint] {
        guard waypoints.count >= 2 else { return waypoints }
        if waypoints.count == 2 {
            return springSamples(from: waypoints[0], to: waypoints[1])
        }
        var out: [CGPoint] = [waypoints[0]]
        var forward: CGVector? = restingForwardVector()
        for i in 1..<waypoints.count {
            let a = waypoints[i - 1]
            let b = waypoints[i]
            let seg = springSamples(from: a, to: b, startForward: forward)
            if seg.count > 1 {
                out.append(contentsOf: seg.dropFirst())
            }
            if seg.count >= 2 {
                let p0 = seg[seg.count - 2]
                let p1 = seg[seg.count - 1]
                let d = CGVector(dx: p1.x - p0.x, dy: p1.y - p0.y)
                let len = hypot(d.dx, d.dy)
                if len > 1e-3 {
                    forward = CGVector(dx: d.dx / len, dy: d.dy / len)
                }
            }
        }
        return out
    }

    /// Visible-frame clamp for tip (OCU `clampTipPosition`).
    static func clampTipPosition(_ tipPosition: CGPoint) -> CGPoint {
        let screen = NSScreen.screens.first(where: { $0.frame.contains(tipPosition) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let screen else { return tipPosition }
        let visible = screen.visibleFrame
        let tip = AgentCursorStyle.tipAnchor
        let size = AgentCursorStyle.windowSize
        let minX = visible.minX + tip.x
        let maxX = visible.maxX - (size.width - tip.x)
        let minY = visible.minY + tip.y
        let maxY = visible.maxY - (size.height - tip.y)
        return CGPoint(
            x: min(max(tipPosition.x, minX), maxX),
            y: min(max(tipPosition.y, minY), maxY)
        )
    }

    private static func motionBounds(from start: CGPoint, to end: CGPoint) -> CGRect? {
        // Prefer union of screens containing endpoints (OCU motionBounds).
        let s0 = NSScreen.screens.first(where: { $0.frame.contains(start) })
        let s1 = NSScreen.screens.first(where: { $0.frame.contains(end) })
        if let a = s0 ?? s1, let b = s1 ?? s0, a.frame == b.frame {
            return a.visibleFrame
        }
        let pad: CGFloat = 96
        let minX = min(start.x, end.x) - pad
        let minY = min(start.y, end.y) - pad
        let maxX = max(start.x, end.x) + pad
        let maxY = max(start.y, end.y) + pad
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

// MARK: - Cursor tint (random hue per control session)

/// Per-session cursor colour. Only the **hue** is random — lightness and chroma
/// are pinned to the app's brand formula `oklch(0.65 0.20 h)`, so every roll comes
/// out at the same perceptual weight instead of occasionally landing on a muddy or
/// low-contrast RGB. Successive rolls step by the golden angle so two consecutive
/// control sessions never come up with near-identical colours.
enum AgentCursorTint {
    private static let goldenAngle: CGFloat = 137.507

    private struct Palette {
        let fillTop: NSColor
        let fillBottom: NSColor
        let fog: NSColor
    }

    private static var hue: CGFloat = CGFloat.random(in: 0..<360)
    /// Cached: `draw(_:)` reads these every frame, and building them runs a
    /// binary search per colour. Only `roll()` can invalidate them.
    private static var palette: Palette = makePalette(hue: hue)

    /// Advance to the next hue. Called once per control session (first show).
    static func roll() {
        hue = (hue + goldenAngle).truncatingRemainder(dividingBy: 360)
        palette = makePalette(hue: hue)
    }

    static var currentHue: CGFloat { hue }

    /// Body gradient runs bright → deep within the same hue.
    static var fillTop: NSColor { palette.fillTop }
    static var fillBottom: NSColor { palette.fillBottom }
    /// Fog is a *glow*, not a shadow: high chroma at mid lightness. A dark,
    /// half-saturated fog reads as neither light nor shade and just looks like
    /// a smudge on light backgrounds — this keeps it clean on white and makes
    /// it luminous on dark ones.
    static var fog: NSColor { palette.fog }

    private static func makePalette(hue: CGFloat) -> Palette {
        let k = yellowLobe(hue)
        func tone(_ L: CGFloat, _ C: CGFloat, lift: CGFloat, ease: CGFloat) -> NSColor {
            let adjustedL = L + lift * k
            let adjustedC = gamutSafeChroma(adjustedL, C - ease * k, hue)
            return oklch(adjustedL, adjustedC, hue)
        }
        return Palette(
            fillTop:    tone(0.70, 0.19, lift: 0.16, ease: 0.03),
            fillBottom: tone(0.48, 0.17, lift: 0.14, ease: 0.02),
            fog:        tone(0.62, 0.21, lift: 0.15, ease: 0.03)
        )
    }

    /// Weight peaking at the yellow lobe (~108°) and falling to zero 90° away.
    ///
    /// Yellow and green sit at a far higher natural lightness than blue or
    /// violet, so sampling every hue at one fixed L renders roughly 90–135° as
    /// olive/mustard. Lifting L there (and easing chroma slightly) turns that
    /// band into clean golds and lime greens.
    private static func yellowLobe(_ hue: CGFloat) -> CGFloat {
        let centred = (hue - 108).truncatingRemainder(dividingBy: 360)
        let delta = abs((centred + 540).truncatingRemainder(dividingBy: 360) - 180)
        return pow(max(0, cos(delta * .pi / 180)), 1.6)
    }

    /// Largest chroma at this (L, hue) that still lands inside sRGB.
    ///
    /// `oklch(0.70 0.19 h)` falls outside sRGB across most of 45–300°. Clipping
    /// silently changes the colour, and it clips the two ends of the body
    /// gradient by different amounts, which flattens the shading.
    private static func gamutSafeChroma(_ L: CGFloat, _ C: CGFloat, _ hue: CGFloat) -> CGFloat {
        guard C > 0, clipsSRGB(L, C, hue) else { return max(C, 0) }
        var low: CGFloat = 0
        var high = C
        for _ in 0..<14 {
            let mid = (low + high) / 2
            if clipsSRGB(L, mid, hue) { high = mid } else { low = mid }
        }
        return low
    }

    private static func clipsSRGB(_ L: CGFloat, _ C: CGFloat, _ hue: CGFloat) -> Bool {
        let (r, g, b) = linearRGB(L, C, hue)
        let epsilon: CGFloat = 0.002
        return r < -epsilon || r > 1 + epsilon
            || g < -epsilon || g > 1 + epsilon
            || b < -epsilon || b > 1 + epsilon
    }

    /// OKLCh → linear sRGB. Mirrors `brandHueToOklch` in @superone/shared/harness-brand.
    private static func linearRGB(
        _ L: CGFloat,
        _ C: CGFloat,
        _ hueDeg: CGFloat
    ) -> (CGFloat, CGFloat, CGFloat) {
        let h = hueDeg * .pi / 180
        let a = C * cos(h)
        let b = C * sin(h)
        let l_ = L + 0.3963377774 * a + 0.2158037573 * b
        let m_ = L - 0.1055613458 * a - 0.0638541728 * b
        let s_ = L - 0.0894841775 * a - 1.2914855480 * b
        let l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
        return (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        )
    }

    static func oklch(_ L: CGFloat, _ C: CGFloat, _ hueDeg: CGFloat, alpha: CGFloat = 1) -> NSColor {
        let (r, g, b) = linearRGB(L, C, hueDeg)
        func gamma(_ x: CGFloat) -> CGFloat {
            let v = x <= 0.0031308 ? 12.92 * x : 1.055 * pow(max(x, 0), 1 / 2.4) - 0.055
            return min(max(v, 0), 1)
        }
        return NSColor(srgbRed: gamma(r), green: gamma(g), blue: gamma(b), alpha: alpha)
    }
}

// MARK: - Vector glyph (replaces the shipped OCU bitmap)

/// Procedurally drawn cursor: a rounded, symmetric swallowtail arrow.
/// Vector rather than a bitmap because the tint is per-session — tinting an
/// image would dye its white keyline too — and it stays crisp at any rotation
/// and size, which the old 13pt bitmap did not.
enum AgentCursorGlyph {
    /// Main-axis span in points, inside the 126pt overlay window.
    static let overlaySize: CGFloat = 24
    /// Main-axis span for the menu-bar badge.
    static let badgeSize: CGFloat = 18

    /// Symmetric swallowtail. The shipped artwork was slightly lopsided
    /// (31°/0.887 vs -24°/1.00); at vector sharpness that reads as a defect
    /// rather than as character, so both wings are matched.
    private static let wingAngle: CGFloat = 27.5
    private static let wingRadius: CGFloat = 0.94
    private static let notchRadius: CGFloat = 0.66
    private static let cornerRatio: CGFloat = 0.10
    private static let tipCornerRatio: CGFloat = 0.055
    private static let strokeRatio: CGFloat = 0.085

    /// Tip at `tip`, neutral heading top-left (matches `artworkNeutralHeading`).
    /// No rotation here — callers rotate the context around the window centre.
    static func path(size: CGFloat, tip: CGPoint) -> NSBezierPath {
        func polar(_ deg: CGFloat, _ r: CGFloat) -> CGPoint {
            let a = deg * .pi / 180
            return CGPoint(x: cos(a) * r * size, y: sin(a) * r * size)
        }
        let points = [
            CGPoint(x: 0, y: 0),
            polar(wingAngle, wingRadius),
            CGPoint(x: notchRadius * size, y: 0),
            polar(-wingAngle, wingRadius),
        ]
        let radii = [
            tipCornerRatio * size,
            cornerRatio * size,
            cornerRatio * size,
            cornerRatio * size,
        ]
        let path = roundedPolygon(points, radii)
        var transform = AffineTransform.identity
        transform.translate(x: tip.x, y: tip.y)
        transform.rotate(byRadians: -.pi / 4)
        path.transform(using: transform)
        return path
    }

    /// White outline + tinted gradient body + drop shadow.
    /// `gradientAngle` follows the glyph's rotation so the shading stays lit
    /// from the same direction as the artwork turns.
    static func draw(size: CGFloat, tip: CGPoint, gradientAngle: CGFloat, shadow: Bool = true) {
        let path = path(size: size, tip: tip)
        path.lineJoinStyle = .round
        path.lineCapStyle = .round
        path.lineWidth = size * strokeRatio
        let outline = NSColor(calibratedWhite: 1.0, alpha: 0.96)
        if shadow, let ctx = NSGraphicsContext.current?.cgContext {
            ctx.saveGState()
            ctx.setShadow(
                offset: CGSize(width: 0, height: -size * 0.045),
                blur: size * 0.11,
                color: NSColor(calibratedWhite: 0, alpha: 0.32).cgColor
            )
            outline.setStroke()
            path.stroke()
            ctx.restoreGState()
        }
        // Stroke is centred, so the inner half gets covered by the fill below —
        // the net effect is an outer white keyline, like the original artwork.
        outline.setStroke()
        path.stroke()
        NSGradient(starting: AgentCursorTint.fillTop, ending: AgentCursorTint.fillBottom)?
            .draw(in: path, angle: gradientAngle)
    }

    /// Rounded polygon. Each radius is clamped to half of its shorter adjacent
    /// edge, so shrinking `size` can never collapse the outline into a blob.
    private static func roundedPolygon(_ points: [CGPoint], _ radii: [CGFloat]) -> NSBezierPath {
        let path = NSBezierPath()
        let n = points.count
        guard n >= 3 else { return path }
        var r = radii
        for i in 0..<n {
            let prev = points[(i + n - 1) % n]
            let cur = points[i]
            let next = points[(i + 1) % n]
            let half1 = hypot(cur.x - prev.x, cur.y - prev.y) / 2
            let half2 = hypot(next.x - cur.x, next.y - cur.y) / 2
            r[i] = min(r[i], min(half1, half2))
        }
        path.move(to: CGPoint(
            x: (points[n - 1].x + points[0].x) / 2,
            y: (points[n - 1].y + points[0].y) / 2
        ))
        for i in 0..<n {
            let cur = points[i]
            let next = points[(i + 1) % n]
            let mid = CGPoint(x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2)
            path.appendArc(from: cur, to: mid, radius: r[i])
        }
        path.close()
        return path
    }
}

final class AgentCursorView: NSView {
    /// OCU `SoftwareCursorView` render state (screen-state space; flipped for AppKit draw).
    var rotation: CGFloat = 0
    var cursorBodyOffset: CGVector = .zero
    var fogOffset: CGVector = .zero
    var fogOpacity: CGFloat = 0.12
    var fogScale: CGFloat = 1
    var clickProgress: CGFloat = 0

    override var isOpaque: Bool { false }
    /// Must be false so AppKit calls `draw(_:)`. With wantsUpdateLayer=true the
    /// view only ran updateLayer() (clear fill) and the cursor never painted.
    override var wantsUpdateLayer: Bool { false }

    func apply(renderState: CursorVisualRenderState, clickProgress: CGFloat) {
        rotation = renderState.rotation
        cursorBodyOffset = renderState.cursorBodyOffset
        fogOffset = renderState.fogOffset
        fogOpacity = renderState.fogOpacity
        fogScale = renderState.fogScale
        self.clickProgress = clickProgress
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let bounds = self.bounds
        // Match OCU `SoftwareCursorGlyphRenderState.appKitDrawingState` flips.
        let drawRotation = -rotation
        let drawBody = CGVector(dx: cursorBodyOffset.dx, dy: -cursorBodyOffset.dy)
        let drawFog = CGVector(dx: fogOffset.dx, dy: -fogOffset.dy)
        let pulse = clickProgress

        guard let context = NSGraphicsContext.current?.cgContext else { return }

        // Fog first, in its own (unrotated) space — it lags the body independently.
        let fogRadius = 26 * fogScale
        let fogCenter = CGPoint(
            x: bounds.midX + drawFog.dx,
            y: bounds.midY + drawFog.dy
        )
        let fogAlpha = min(max(fogOpacity, 0.12), 0.32)
        let fogColor = AgentCursorTint.fog
        // Five stops approximating a gaussian. A three-stop linear ramp leaves a
        // visible grey rim where the gradient ends, which reads as dirt.
        let fogStops = [
            fogColor.withAlphaComponent(fogAlpha).cgColor,
            fogColor.withAlphaComponent(fogAlpha * 0.72).cgColor,
            fogColor.withAlphaComponent(fogAlpha * 0.38).cgColor,
            fogColor.withAlphaComponent(fogAlpha * 0.13).cgColor,
            fogColor.withAlphaComponent(0).cgColor,
        ] as CFArray
        if let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: fogStops,
            locations: [0, 0.25, 0.5, 0.75, 1]
        ) {
            context.saveGState()
            context.drawRadialGradient(
                gradient,
                startCenter: fogCenter,
                startRadius: 0,
                endCenter: fogCenter,
                endRadius: fogRadius,
                options: []
            )
            context.restoreGState()
        }

        // Same transform chain as the OCU GlyphRenderer: rotate / lag the body
        // around the window centre, with a squash driven by speed and click pulse.
        let motionCompression = min(hypot(drawBody.dx, drawBody.dy) * 0.008, 0.018)
        let pulseCompression = pulse * 0.03
        context.saveGState()
        context.translateBy(
            x: bounds.midX + drawBody.dx,
            y: bounds.midY + drawBody.dy
        )
        context.rotate(by: drawRotation)
        context.scaleBy(
            x: 1 - motionCompression - pulseCompression,
            y: 1 + (pulseCompression * 0.4)
        )
        context.translateBy(x: -bounds.midX, y: -bounds.midY)
        AgentCursorGlyph.draw(
            size: AgentCursorGlyph.overlaySize,
            tip: AgentCursorStyle.tipAnchor,
            gradientAngle: -45 + drawRotation * 180 / .pi
        )
        context.restoreGState()
    }

    func pulseClick() {
        // OCU clickProgress squash on the glyph (no layer-scale — keeps tip stable).
        clickProgress = 1
        needsDisplay = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
            self?.clickProgress = 0.45
            self?.needsDisplay = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { [weak self] in
            self?.clickProgress = 0
            self?.needsDisplay = true
        }
    }
}

// MARK: - Status menu

/// One app currently under Computer Use control, as reported by the host.
/// The host owns this list (it is derived from granted policy there); the helper
/// only renders it, so the two can never drift.
