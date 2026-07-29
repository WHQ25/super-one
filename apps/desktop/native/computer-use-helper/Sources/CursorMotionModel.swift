/**
 * Cursor motion model from open-computer-use (MIT License, Copyright 2026 Leo).
 *
 * Cubic path candidates, heading-driven arcs, and official progress-spring timing
 * used by the software cursor. Vendored for SuperOne Computer Use overlay /
 * drag visualization — see Resources/NOTICE.md.
 *
 * Source: packages/OpenComputerUseKit/.../CursorMotionModel.swift
 * https://github.com/iFurySt/open-codex-computer-use
 */

import CoreGraphics
import Foundation

// Minimal shim for OCU visual-dynamics helpers that live in SoftwareCursorOverlay
// in the upstream kit. SuperOne only needs progress-spring + path candidates for
// the software cursor; these keep the vendored file compiling.
func visualCursorScreenStateVelocity(
    fromRuntimeVelocity velocity: CGVector,
    yAxisMultiplier: CGFloat
) -> CGVector {
    CGVector(dx: velocity.dx, dy: velocity.dy * yAxisMultiplier)
}
struct CursorMotionSegment: Equatable {
    let end: CGPoint
    let control1: CGPoint
    let control2: CGPoint
}

struct CursorMotionPath: Equatable {
    let start: CGPoint
    let end: CGPoint
    let startControl: CGPoint?
    let arc: CGPoint?
    let arcIn: CGPoint?
    let arcOut: CGPoint?
    let endControl: CGPoint?
    let segments: [CursorMotionSegment]
    let curveScale: CGFloat

    init(
        start: CGPoint,
        end: CGPoint,
        startControl: CGPoint? = nil,
        arc: CGPoint? = nil,
        arcIn: CGPoint? = nil,
        arcOut: CGPoint? = nil,
        endControl: CGPoint? = nil,
        segments: [CursorMotionSegment],
        curveScale: CGFloat = 1
    ) {
        self.start = start
        self.end = end
        self.startControl = startControl
        self.arc = arc
        self.arcIn = arcIn
        self.arcOut = arcOut
        self.endControl = endControl
        self.segments = segments
        self.curveScale = curveScale
    }

    init(start: CGPoint, end: CGPoint, curveDirection: CGFloat? = nil, curveScale: CGFloat = 1) {
        let delta = end - start
        let distance = max(delta.length, 1)
        let normal = delta.perpendicular.normalized
        let resolvedCurveDirection = curveDirection ?? (delta.dx >= 0 ? 1 : -1)
        let resolvedCurveScale = max(curveScale, 0)
        let curveAmount = min(max(distance * 0.22, 28), 110) * resolvedCurveScale
        let controlOffset = normal.scaled(by: curveAmount * resolvedCurveDirection)
        let control1Base = CGPoint(
            x: start.x + (delta.dx * (resolvedCurveScale == 0 ? 1.0 / 3.0 : 0.18)),
            y: start.y + (delta.dy * (resolvedCurveScale == 0 ? 1.0 / 3.0 : 0.10))
        )
        let control2Base = CGPoint(
            x: start.x + (delta.dx * (resolvedCurveScale == 0 ? 2.0 / 3.0 : 0.80)),
            y: start.y + (delta.dy * (resolvedCurveScale == 0 ? 2.0 / 3.0 : 0.96))
        )
        let control1 = control1Base + controlOffset
        let control2 = control2Base + controlOffset.scaled(by: 0.48)

        self.init(
            start: start,
            end: end,
            startControl: control1,
            endControl: control2,
            segments: [
                CursorMotionSegment(end: end, control1: control1, control2: control2)
            ],
            curveScale: resolvedCurveScale
        )
    }

    func point(at progress: CGFloat) -> CGPoint {
        sample(at: progress).point
    }

    func tangent(at progress: CGFloat) -> CGVector {
        sample(at: progress).tangent
    }

    func sample(at progress: CGFloat) -> (point: CGPoint, tangent: CGVector) {
        guard !segments.isEmpty else {
            return (start, CGVector(dx: 1, dy: 0))
        }

        let clamped = progress.clamped(to: 0...1)
        let segmentCount = segments.count
        let segmentIndex: Int
        let localT: CGFloat

        if clamped >= 1 {
            segmentIndex = segmentCount - 1
            localT = 1
        } else {
            let scaled = clamped * CGFloat(segmentCount)
            segmentIndex = min(Int(scaled), segmentCount - 1)
            localT = scaled - CGFloat(segmentIndex)
        }

        let segment = segments[segmentIndex]
        let segmentStart = segmentIndex == 0 ? start : segments[segmentIndex - 1].end
        let point = sampleCubic(
            start: segmentStart,
            control1: segment.control1,
            control2: segment.control2,
            end: segment.end,
            t: localT
        )
        let tangent = sampleCubicTangent(
            start: segmentStart,
            control1: segment.control1,
            control2: segment.control2,
            end: segment.end,
            t: localT
        ).normalized
        return (point, tangent)
    }

    func sampledConstraintPoints(samplesPerSegment: Int = 6) -> [CGPoint] {
        let totalSteps = max(segments.count * max(samplesPerSegment, 1), 1)
        return (1...totalSteps).map { step in
            point(at: CGFloat(step) / CGFloat(totalSteps))
        }
    }

    func measure(bounds: CGRect?, minStepDistance: CGFloat = 0.01, samplesPerSegment: Int = 24) -> CursorMotionMeasurement {
        var totalLength: CGFloat = 0
        var angleChangeEnergy: CGFloat = 0
        var maxAngleChange: CGFloat = 0
        var totalTurn: CGFloat = 0
        var staysInBounds = bounds?.contains(start, padding: 20) ?? true
        var previousPoint = start
        var previousAngle: CGFloat?

        let totalSteps = max(segments.count * max(samplesPerSegment, 1), 1)
        for step in 1...totalSteps {
            let progress = CGFloat(step) / CGFloat(totalSteps)
            let point = point(at: progress)
            let delta = point - previousPoint
            let stepLength = delta.length

            if let bounds, staysInBounds {
                staysInBounds = bounds.contains(point, padding: 20)
            }

            if stepLength > minStepDistance {
                let angle = atan2(delta.dy, delta.dx)
                totalLength += stepLength

                if let previousAngle {
                    var angleDelta = angle - previousAngle
                    while angleDelta > .pi {
                        angleDelta -= (.pi * 2)
                    }
                    while angleDelta < -.pi {
                        angleDelta += (.pi * 2)
                    }

                    angleChangeEnergy += angleDelta * angleDelta
                    let absoluteDelta = abs(angleDelta)
                    maxAngleChange = max(maxAngleChange, absoluteDelta)
                    totalTurn += absoluteDelta
                }

                previousAngle = angle
                previousPoint = point
            }
        }

        return CursorMotionMeasurement(
            length: totalLength,
            angleChangeEnergy: angleChangeEnergy,
            maxAngleChange: maxAngleChange,
            totalTurn: totalTurn,
            staysInBounds: staysInBounds
        )
    }
}

struct CursorMotionMeasurement: Equatable {
    let length: CGFloat
    let angleChangeEnergy: CGFloat
    let maxAngleChange: CGFloat
    let totalTurn: CGFloat
    let staysInBounds: Bool
}

struct CursorMotionCandidate: Equatable {
    let identifier: String
    let kind: CursorMotionKind
    let side: Int
    let tableAScale: CGFloat?
    let tableBScale: CGFloat?
    let path: CursorMotionPath
    let measurement: CursorMotionMeasurement
    let score: CGFloat
}

enum CursorMotionKind: String, Equatable {
    case base
    case arched
}

struct CursorMotionSpringConfiguration: Equatable {
    let response: CGFloat
    let dampingFraction: CGFloat
    let stiffness: CGFloat
    let drag: CGFloat
    let dt: CGFloat
    let closeEnoughProgressThreshold: CGFloat
    let closeEnoughDistanceThreshold: CGFloat
    let idleVelocityThreshold: CGFloat

    static let official: CursorMotionSpringConfiguration = {
        let response: CGFloat = 1.4
        let dampingFraction: CGFloat = 0.9
        let dt: CGFloat = 1.0 / 240.0
        let idleVelocityThreshold: CGFloat = 28_800
        let rawStiffness = response > 0 ? pow((2 * .pi) / response, 2) : .infinity
        let stiffness = min(rawStiffness, idleVelocityThreshold)
        let drag = 2 * dampingFraction * sqrt(stiffness)

        return CursorMotionSpringConfiguration(
            response: response,
            dampingFraction: dampingFraction,
            stiffness: stiffness,
            drag: drag,
            dt: dt,
            closeEnoughProgressThreshold: 1,
            closeEnoughDistanceThreshold: 0.01,
            idleVelocityThreshold: idleVelocityThreshold
        )
    }()
}

struct CursorMotionSpringState: Equatable {
    var time: CGFloat = 0
    var velocity: CGFloat = 0
    var force: CGFloat = 0
}

enum CursorMotionProgressAnimator {
    static func advance(
        current: CGFloat,
        target: CGFloat = 1,
        state: CursorMotionSpringState,
        configuration: CursorMotionSpringConfiguration = .official
    ) -> (current: CGFloat, state: CursorMotionSpringState) {
        let halfDT = configuration.dt * 0.5
        let velocityHalf = state.velocity + (state.force * halfDT)
        let nextCurrent = current + (velocityHalf * configuration.dt)
        let force = (configuration.stiffness * (target - nextCurrent)) + ((-configuration.drag) * velocityHalf)
        let velocity = velocityHalf + (force * halfDT)

        return (
            nextCurrent,
            CursorMotionSpringState(
                time: state.time + configuration.dt,
                velocity: velocity,
                force: force
            )
        )
    }

    static func advance(
        current: CGFloat,
        target: CGFloat = 1,
        state: CursorMotionSpringState,
        configuration: CursorMotionSpringConfiguration = .official,
        to targetTime: CGFloat
    ) -> (current: CGFloat, state: CursorMotionSpringState) {
        var adjustedState = state
        var adjustedCurrent = current

        if (targetTime - adjustedState.time) > 1 {
            adjustedState.time = targetTime - (1.0 / 60.0)
        }

        while adjustedState.time < targetTime {
            (adjustedCurrent, adjustedState) = advance(
                current: adjustedCurrent,
                target: target,
                state: adjustedState,
                configuration: configuration
            )
        }

        return (adjustedCurrent, adjustedState)
    }

    static func isCloseEnough(
        progress: CGFloat,
        target: CGFloat = 1,
        configuration: CursorMotionSpringConfiguration = .official
    ) -> Bool {
        progress >= configuration.closeEnoughProgressThreshold
            && abs(target - progress) <= configuration.closeEnoughDistanceThreshold
    }

    static func closeEnoughTime(
        configuration: CursorMotionSpringConfiguration = .official
    ) -> CGFloat {
        var current: CGFloat = 0
        var state = CursorMotionSpringState()
        var step = 0

        while step < 4_096 {
            step += 1
            let targetTime = CGFloat(step) * configuration.dt
            (current, state) = advance(
                current: current,
                target: 1,
                state: state,
                configuration: configuration,
                to: targetTime
            )

            if isCloseEnough(progress: current, configuration: configuration) {
                return state.time
            }
        }

        return 1.43
    }
}

enum OfficialCursorMotionModel {
    static let minimumStepDistance: CGFloat = 0.01
    static let guideVectorInLocalBasis = CGVector(dx: -0.6946583704589973, dy: 0.7193398003386512)
    static let tableA: [CGFloat] = [0.55, 0.8, 1.05]
    static let tableB: [CGFloat] = [0.65, 1.0, 1.35]
    static let closeEnoughTime = CursorMotionProgressAnimator.closeEnoughTime()

    private static let normalizationEpsilon: CGFloat = 0.001
    private static let sideBiasScale: CGFloat = 0.65
    private static let primaryDistanceScale: CGFloat = 0.41960295031576633
    private static let directSpanScale: CGFloat = 0.9
    private static let secondaryDistanceScale: CGFloat = 0.2765523188064277
    private static let arcDistanceScale: CGFloat = 0.5783555327868779
    private static let candidateArcMin: CGFloat = 38
    private static let candidateArcMax: CGFloat = 440
    private static let scoreExcessLengthWeight: CGFloat = 320
    private static let scoreAngleEnergyWeight: CGFloat = 140
    private static let scoreMaxAngleWeight: CGFloat = 180
    private static let scoreTotalTurnWeight: CGFloat = 18
    private static let scoreOutOfBoundsPenalty: CGFloat = 45

    static func makeCandidates(start: CGPoint, end: CGPoint, bounds: CGRect?) -> [CursorMotionCandidate] {
        let delta = end - start
        let distance = max(delta.length, normalizationEpsilon)
        let direction = delta.normalized
        let localNormal = direction.perpendicular
        let guide = direction.scaled(by: guideVectorInLocalBasis.dx)
            + localNormal.scaled(by: guideVectorInLocalBasis.dy)
        let reverseGuide = guide.scaled(by: -1)

        let (startExtentPre, endExtentPre) = binaryPiecewisePrimaryExtents(distance: distance)
        let startExtent = min(startExtentPre, clipPositiveRay(origin: start, direction: guide, bounds: bounds))
        let endExtent = min(endExtentPre, clipPositiveRay(origin: end, direction: reverseGuide, bounds: bounds))

        let startExtentScaled = min(
            max(startExtent * sideBiasScale, 0),
            clipPositiveRay(origin: start, direction: guide, bounds: bounds)
        )
        let endExtentScaled = min(
            max(endExtent * sideBiasScale, 0),
            clipPositiveRay(origin: end, direction: reverseGuide, bounds: bounds)
        )

        let fullStartControl = start + guide.scaled(by: startExtent)
        let fullEndControl = end - guide.scaled(by: endExtent)
        let scaledStartControl = start + guide.scaled(by: startExtentScaled)
        let scaledEndControl = end - guide.scaled(by: endExtentScaled)

        let rawHandleExtent = binaryPiecewiseHandleExtent(distance: distance)
        let rawArcExtent = (distance * arcDistanceScale).clamped(to: candidateArcMin...candidateArcMax)

        let midpoint = CGPoint(x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5)
        var signedNormal = localNormal
        let cross = (guide.dy * direction.dx) - (guide.dx * direction.dy)
        if cross < 0 {
            signedNormal = signedNormal.scaled(by: -1)
        }
        let arcAnchorBias = guide.scaled(by: startExtent * sideBiasScale)
        let forwardUnit = normalizedOrDefault(
            direction.scaled(by: distance) + signedNormal.scaled(by: rawArcExtent),
            minimumLength: rawHandleExtent
        )

        var candidates: [CursorMotionCandidate] = []
        candidates.append(
            makeCandidate(
                identifier: "base-full-guide",
                kind: .base,
                side: 0,
                tableAScale: nil,
                tableBScale: nil,
                path: CursorMotionPath(
                    start: start,
                    end: end,
                    startControl: fullStartControl,
                    endControl: fullEndControl,
                    segments: [
                        CursorMotionSegment(end: end, control1: fullStartControl, control2: fullEndControl)
                    ],
                    curveScale: 1
                ),
                distance: distance,
                bounds: bounds
            )
        )
        candidates.append(
            makeCandidate(
                identifier: "base-scaled-guide",
                kind: .base,
                side: 0,
                tableAScale: nil,
                tableBScale: nil,
                path: CursorMotionPath(
                    start: start,
                    end: end,
                    startControl: scaledStartControl,
                    endControl: scaledEndControl,
                    segments: [
                        CursorMotionSegment(end: end, control1: scaledStartControl, control2: scaledEndControl)
                    ],
                    curveScale: sideBiasScale
                ),
                distance: distance,
                bounds: bounds
            )
        )

        for outerScale in tableA {
            let anchorOffset = signedNormal.scaled(by: rawHandleExtent * outerScale)
            for innerScale in tableB {
                let tangentSpan = forwardUnit.scaled(by: rawArcExtent * innerScale)

                for side in [1, -1] {
                    let anchor = midpoint + arcAnchorBias + anchorOffset.scaled(by: CGFloat(side))
                    let arcIn = anchor - tangentSpan
                    let arcOut = anchor + tangentSpan
                    let path = CursorMotionPath(
                        start: start,
                        end: end,
                        startControl: fullStartControl,
                        arc: anchor,
                        arcIn: arcIn,
                        arcOut: arcOut,
                        endControl: fullEndControl,
                        segments: [
                            CursorMotionSegment(end: anchor, control1: fullStartControl, control2: arcIn),
                            CursorMotionSegment(end: end, control1: arcOut, control2: fullEndControl)
                        ],
                        curveScale: innerScale
                    )

                    candidates.append(
                        makeCandidate(
                            identifier: "a\(outerScale.cursorIdentifier)-b\(innerScale.cursorIdentifier)-\(side > 0 ? "positive" : "negative")",
                            kind: .arched,
                            side: side,
                            tableAScale: outerScale,
                            tableBScale: innerScale,
                            path: path,
                            distance: distance,
                            bounds: bounds
                        )
                    )
                }
            }
        }

        return candidates
    }

    static func chooseBestCandidate(from candidates: [CursorMotionCandidate]) -> CursorMotionCandidate? {
        guard !candidates.isEmpty else {
            return nil
        }

        let inBoundsCandidates = candidates.filter(\.measurement.staysInBounds)
        let pool = inBoundsCandidates.isEmpty ? candidates : inBoundsCandidates
        return pool.min { lhs, rhs in
            if lhs.score == rhs.score {
                return lhs.identifier < rhs.identifier
            }
            return lhs.score < rhs.score
        }
    }

    static func calibratedTravelDuration(distance _: CGFloat, measurement _: CursorMotionMeasurement) -> CGFloat {
        closeEnoughTime
    }

    private static func makeCandidate(
        identifier: String,
        kind: CursorMotionKind,
        side: Int,
        tableAScale: CGFloat?,
        tableBScale: CGFloat?,
        path: CursorMotionPath,
        distance: CGFloat,
        bounds: CGRect?
    ) -> CursorMotionCandidate {
        let measurement = path.measure(bounds: bounds, minStepDistance: minimumStepDistance)
        let score = scoreCandidate(distance: distance, measurement: measurement)
        return CursorMotionCandidate(
            identifier: identifier,
            kind: kind,
            side: side,
            tableAScale: tableAScale,
            tableBScale: tableBScale,
            path: path,
            measurement: measurement,
            score: score
        )
    }

    private static func scoreCandidate(distance: CGFloat, measurement: CursorMotionMeasurement) -> CGFloat {
        let excessLengthRatio = max((measurement.length / max(distance, 1)) - 1, 0)
        return (excessLengthRatio * scoreExcessLengthWeight)
            + (measurement.angleChangeEnergy * scoreAngleEnergyWeight)
            + (measurement.maxAngleChange * scoreMaxAngleWeight)
            + (measurement.totalTurn * scoreTotalTurnWeight)
            + (measurement.staysInBounds ? 0 : scoreOutOfBoundsPenalty)
    }

    private static func binaryPiecewisePrimaryExtents(distance: CGFloat) -> (startExtent: CGFloat, endExtent: CGFloat) {
        let primary = distance * primaryDistanceScale
        let direct = distance * directSpanScale
        let secondary = distance * 0.15
        let lowCutoff: CGFloat = 48
        let highCutoff: CGFloat = 640

        if primary < lowCutoff {
            return (lowCutoff, lowCutoff)
        }
        if primary < highCutoff {
            return (primary, direct)
        }
        if secondary < highCutoff {
            return (highCutoff, lowCutoff)
        }
        return (highCutoff, highCutoff)
    }

    private static func binaryPiecewiseHandleExtent(distance: CGFloat) -> CGFloat {
        let raw = distance * secondaryDistanceScale
        if raw < 50 {
            return 50
        }
        if raw < 640 {
            return raw
        }
        return 520
    }

    private static func clipPositiveRay(origin: CGPoint, direction: CGVector, bounds: CGRect?) -> CGFloat {
        guard let bounds else {
            return .infinity
        }

        var limit = CGFloat.infinity
        if direction.dx > 0 {
            limit = min(limit, (bounds.maxX - origin.x) / direction.dx)
        } else if direction.dx < 0 {
            limit = min(limit, (bounds.minX - origin.x) / direction.dx)
        }

        if direction.dy > 0 {
            limit = min(limit, (bounds.maxY - origin.y) / direction.dy)
        } else if direction.dy < 0 {
            limit = min(limit, (bounds.minY - origin.y) / direction.dy)
        }

        return max(limit, 0)
    }

    private static func normalizedOrDefault(_ vector: CGVector, minimumLength: CGFloat) -> CGVector {
        let length = vector.length
        if length < minimumLength || length < normalizationEpsilon {
            return CGVector(dx: 1, dy: 0)
        }
        return vector.scaled(by: 1 / length)
    }
}
