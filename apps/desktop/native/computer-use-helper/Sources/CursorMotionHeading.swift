/** Heading-driven cursor path candidates from open-computer-use (MIT). */

import CoreGraphics
import Foundation

enum HeadingDrivenCursorMotionModel {
    private static let defaultStartHandle: CGFloat = 0.29
    private static let defaultEndHandle: CGFloat = 0.08
    private static let defaultArcSize: CGFloat = 0.06
    private static let defaultArcFlow: CGFloat = 0.64
    private static let normalizationEpsilon: CGFloat = 0.001

    static func makeCandidates(
        start: CGPoint,
        end: CGPoint,
        bounds: CGRect?,
        startForward: CGVector,
        endForward: CGVector
    ) -> [CursorMotionCandidate] {
        let metrics = MotionMetrics(start: start, end: end)
        let resolvedStartForward = normalizedOrDefault(startForward)
        let resolvedEndForward = normalizedOrDefault(endForward)
        let preferredSide = preferredTurnSide(
            metrics: metrics,
            startForward: resolvedStartForward,
            endForward: resolvedEndForward
        )
        let scoringContext = MotionScoringContext(
            metrics: metrics,
            startForward: resolvedStartForward,
            endForward: resolvedEndForward,
            preferredSide: preferredSide
        )

        return descriptors(for: metrics, preferredSide: preferredSide).map { descriptor in
            let path = makePath(
                from: start,
                to: end,
                metrics: metrics,
                descriptor: descriptor,
                startForward: resolvedStartForward,
                endForward: resolvedEndForward
            )
            return makeCandidate(
                identifier: descriptor.id,
                kind: descriptor.kind,
                side: descriptor.side,
                tableAScale: nil,
                tableBScale: nil,
                path: path,
                bounds: bounds,
                context: scoringContext,
                descriptor: descriptor
            )
        }
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

    static func calibratedTravelDuration(distance: CGFloat, measurement: CursorMotionMeasurement) -> CGFloat {
        OfficialCursorMotionModel.calibratedTravelDuration(distance: distance, measurement: measurement)
    }

    private static func makePath(
        from start: CGPoint,
        to end: CGPoint,
        metrics: MotionMetrics,
        descriptor: MotionDescriptor,
        startForward: CGVector,
        endForward: CGVector
    ) -> CursorMotionPath {
        let distance = metrics.distance
        let direction = metrics.direction
        let normal = metrics.normal
        let resolvedFlow = (defaultArcFlow + descriptor.flowShift).clamped(to: 0...1)
        let flowBias = (resolvedFlow - 0.5) * distance * 0.18

        let baseStartReach = distance * (0.10 + defaultStartHandle * 0.56)
        let baseEndReach = distance * (0.11 + defaultEndHandle * 0.62)
        let distanceLift = 0.68 + (metrics.farFactor * 0.56)
        let baseArcHeight = min(
            max(distance * (0.10 + defaultArcSize * 0.92) * descriptor.arcScale * distanceLift, 20),
            distance * 0.96
        )

        let sideSign = CGFloat(descriptor.side)
        let arcVector = CGVector(
            dx: normal.dx * baseArcHeight * sideSign,
            dy: normal.dy * baseArcHeight * sideSign
        )

        let startGuide = resolvedGuide(
            line: direction,
            forward: startForward,
            normal: normal,
            sideSign: sideSign,
            lineWeight: descriptor.startLineWeight,
            headingWeight: descriptor.startHeadingWeight,
            normalBias: descriptor.startGuideNormalBias
        )
        let endGuide = resolvedGuide(
            line: direction,
            forward: endForward,
            normal: normal,
            sideSign: sideSign,
            lineWeight: descriptor.endLineWeight,
            headingWeight: descriptor.endHeadingWeight,
            normalBias: descriptor.endGuideNormalBias
        )

        let startReach = max(baseStartReach * descriptor.startReachScale + flowBias * descriptor.startFlowWeight, 12)
        let endReach = max(baseEndReach * descriptor.endReachScale - flowBias * descriptor.endFlowWeight, 12)
        let control1Base = start + startGuide.scaled(by: startReach)
        let control2Base = end - endGuide.scaled(by: endReach)

        let control1 = control1Base + arcVector.scaled(by: descriptor.startNormalScale)
        let control2 = control2Base + arcVector.scaled(by: descriptor.endNormalScale)
        let resolvedArcHeight = baseArcHeight * max(
            abs(descriptor.startNormalScale),
            abs(descriptor.endNormalScale),
            0.12
        )

        return CursorMotionPath(
            start: start,
            end: end,
            startControl: control1,
            endControl: control2,
            segments: [
                CursorMotionSegment(end: end, control1: control1, control2: control2)
            ],
            curveScale: resolvedArcHeight
        )
    }

    private static func makeCandidate(
        identifier: String,
        kind: CursorMotionKind,
        side: Int,
        tableAScale: CGFloat?,
        tableBScale: CGFloat?,
        path: CursorMotionPath,
        bounds: CGRect?,
        context: MotionScoringContext,
        descriptor: MotionDescriptor
    ) -> CursorMotionCandidate {
        let measurement = path.measure(bounds: bounds, minStepDistance: OfficialCursorMotionModel.minimumStepDistance)
        let score = scoreCandidate(
            measurement: measurement,
            path: path,
            descriptor: descriptor,
            context: context
        )

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

    private static func scoreCandidate(
        measurement: CursorMotionMeasurement,
        path: CursorMotionPath,
        descriptor: MotionDescriptor,
        context: MotionScoringContext
    ) -> CGFloat {
        let distance = max(context.metrics.distance, 1)
        let excessLengthRatio = max((measurement.length / distance) - 1, 0)
        let startTangent = normalizedOrDefault(path.tangent(at: 0.04))
        let endTangent = normalizedOrDefault(path.tangent(at: 0.96))
        let startHeadingError = abs(signedAngle(from: context.startForward, to: startTangent))
        let endHeadingError = abs(signedAngle(from: endTangent, to: context.endForward))

        var score = descriptor.scoreBias
        score += excessLengthRatio * 180
        score += measurement.angleChangeEnergy * 90
        score += measurement.maxAngleChange * 85
        score += measurement.totalTurn * (descriptor.side == 0 ? 10 : 12)
        score += startHeadingError * 150
        score += endHeadingError * 120

        if descriptor.side == 0 {
            score += context.turnDemand * 130
            score += context.arrivalDemand * 30
        } else {
            score += context.directness * 90
            if descriptor.side != context.preferredSide {
                score += max(context.turnDemand, 0.45) * 200
            }
        }

        switch descriptor.family {
        case "turn":
            score += (1 - context.turnDemand) * 55
        case "brake":
            score += (1 - context.arrivalDemand) * 40
        case "orbit":
            score += context.directness * 70
        case "direct":
            score += max(context.turnDemand - 0.12, 0) * 80
        default:
            break
        }

        if measurement.staysInBounds == false {
            score += 90
        }

        return score
    }

    private static func descriptors(for metrics: MotionMetrics, preferredSide: Int) -> [MotionDescriptor] {
        let orbitScale = 0.82 + (metrics.farFactor * 0.26)
        let turnaroundScale = 0.90 + (metrics.farFactor * 0.30)
        let brakingScale = 0.74 + (metrics.farFactor * 0.24)

        return [
            MotionDescriptor(
                id: "direct-tight",
                family: "direct",
                side: 0,
                startReachScale: 0.90,
                endReachScale: 0.86,
                startLineWeight: 1.12,
                endLineWeight: 1.04,
                startHeadingWeight: 0.18,
                endHeadingWeight: 0.20,
                startNormalScale: 0.02,
                endNormalScale: 0.02,
                startGuideNormalBias: 0,
                endGuideNormalBias: 0,
                startFlowWeight: 0.02,
                endFlowWeight: 0.02,
                flowShift: -0.02,
                arcScale: 0.16,
                scoreBias: 18
            ),
            MotionDescriptor(
                id: "direct-soft",
                family: "direct",
                side: 0,
                startReachScale: 0.98,
                endReachScale: 0.94,
                startLineWeight: 1.04,
                endLineWeight: 0.96,
                startHeadingWeight: 0.22,
                endHeadingWeight: 0.28,
                startNormalScale: 0.04,
                endNormalScale: 0.08,
                startGuideNormalBias: 0,
                endGuideNormalBias: 0.04,
                startFlowWeight: 0.04,
                endFlowWeight: 0.08,
                flowShift: 0.02,
                arcScale: 0.24,
                scoreBias: 24
            ),
            MotionDescriptor(
                id: "turn-primary-tight",
                family: "turn",
                side: preferredSide,
                startReachScale: 1.26,
                endReachScale: 1.30,
                startLineWeight: -0.24,
                endLineWeight: -0.04,
                startHeadingWeight: 1.50,
                endHeadingWeight: 1.18,
                startNormalScale: 0.46,
                endNormalScale: 0.08,
                startGuideNormalBias: 0.30,
                endGuideNormalBias: 0.16,
                startFlowWeight: -0.30,
                endFlowWeight: 0.20,
                flowShift: -0.08,
                arcScale: turnaroundScale,
                scoreBias: 40
            ),
            MotionDescriptor(
                id: "turn-primary-wide",
                family: "turn",
                side: preferredSide,
                startReachScale: 1.30,
                endReachScale: 1.36,
                startLineWeight: -0.28,
                endLineWeight: -0.10,
                startHeadingWeight: 1.54,
                endHeadingWeight: 1.24,
                startNormalScale: 0.58,
                endNormalScale: 0.12,
                startGuideNormalBias: 0.34,
                endGuideNormalBias: 0.20,
                startFlowWeight: -0.34,
                endFlowWeight: 0.24,
                flowShift: 0.06,
                arcScale: turnaroundScale * 1.06,
                scoreBias: 46
            ),
            MotionDescriptor(
                id: "brake-primary-tight",
                family: "brake",
                side: preferredSide,
                startReachScale: 0.92,
                endReachScale: 1.42,
                startLineWeight: 0.50,
                endLineWeight: -0.20,
                startHeadingWeight: 0.70,
                endHeadingWeight: 1.52,
                startNormalScale: 0.16,
                endNormalScale: 0.20,
                startGuideNormalBias: 0.10,
                endGuideNormalBias: 0.26,
                startFlowWeight: 0.10,
                endFlowWeight: 0.32,
                flowShift: -0.04,
                arcScale: brakingScale,
                scoreBias: 44
            ),
            MotionDescriptor(
                id: "brake-primary-wide",
                family: "brake",
                side: preferredSide,
                startReachScale: 0.98,
                endReachScale: 1.50,
                startLineWeight: 0.44,
                endLineWeight: -0.26,
                startHeadingWeight: 0.74,
                endHeadingWeight: 1.62,
                startNormalScale: 0.22,
                endNormalScale: 0.26,
                startGuideNormalBias: 0.12,
                endGuideNormalBias: 0.32,
                startFlowWeight: 0.14,
                endFlowWeight: 0.38,
                flowShift: 0.04,
                arcScale: brakingScale * 1.04,
                scoreBias: 50
            ),
            MotionDescriptor(
                id: "orbit-primary-tight",
                family: "orbit",
                side: preferredSide,
                startReachScale: 0.90,
                endReachScale: 0.98,
                startLineWeight: 0.72,
                endLineWeight: 0.76,
                startHeadingWeight: 0.30,
                endHeadingWeight: 0.22,
                startNormalScale: 0.90,
                endNormalScale: 0.82,
                startGuideNormalBias: 0.16,
                endGuideNormalBias: 0.06,
                startFlowWeight: 0.26,
                endFlowWeight: 0.12,
                flowShift: -0.06,
                arcScale: orbitScale,
                scoreBias: 54
            ),
            MotionDescriptor(
                id: "orbit-primary-wide",
                family: "orbit",
                side: preferredSide,
                startReachScale: 0.94,
                endReachScale: 1.02,
                startLineWeight: 0.68,
                endLineWeight: 0.82,
                startHeadingWeight: 0.28,
                endHeadingWeight: 0.22,
                startNormalScale: 1.02,
                endNormalScale: 0.94,
                startGuideNormalBias: 0.18,
                endGuideNormalBias: 0.08,
                startFlowWeight: 0.30,
                endFlowWeight: 0.16,
                flowShift: 0.06,
                arcScale: orbitScale * 1.06,
                scoreBias: 60
            ),
            MotionDescriptor(
                id: "turn-secondary",
                family: "turn",
                side: -preferredSide,
                startReachScale: 1.18,
                endReachScale: 1.26,
                startLineWeight: -0.18,
                endLineWeight: 0.02,
                startHeadingWeight: 1.32,
                endHeadingWeight: 1.08,
                startNormalScale: 0.34,
                endNormalScale: 0.06,
                startGuideNormalBias: 0.22,
                endGuideNormalBias: 0.14,
                startFlowWeight: -0.20,
                endFlowWeight: 0.14,
                flowShift: 0.02,
                arcScale: turnaroundScale * 0.92,
                scoreBias: 88
            ),
            MotionDescriptor(
                id: "brake-secondary",
                family: "brake",
                side: -preferredSide,
                startReachScale: 0.90,
                endReachScale: 1.34,
                startLineWeight: 0.52,
                endLineWeight: -0.16,
                startHeadingWeight: 0.62,
                endHeadingWeight: 1.40,
                startNormalScale: 0.12,
                endNormalScale: 0.18,
                startGuideNormalBias: 0.08,
                endGuideNormalBias: 0.20,
                startFlowWeight: 0.10,
                endFlowWeight: 0.28,
                flowShift: -0.02,
                arcScale: brakingScale * 0.92,
                scoreBias: 96
            ),
        ]
    }

    private static func preferredTurnSide(
        metrics: MotionMetrics,
        startForward: CGVector,
        endForward: CGVector
    ) -> Int {
        let startDelta = signedAngle(from: startForward, to: metrics.direction)
        if abs(startDelta) > 0.16 {
            return startDelta > 0 ? 1 : -1
        }

        let endDelta = signedAngle(from: metrics.direction, to: endForward)
        if abs(endDelta) > 0.18 {
            return endDelta > 0 ? -1 : 1
        }

        if abs(metrics.dy) > abs(metrics.dx) * 0.72 {
            return metrics.dy > 0 ? -1 : 1
        }

        return metrics.dx >= 0 ? 1 : -1
    }

    private static func resolvedGuide(
        line: CGVector,
        forward: CGVector,
        normal: CGVector,
        sideSign: CGFloat,
        lineWeight: CGFloat,
        headingWeight: CGFloat,
        normalBias: CGFloat
    ) -> CGVector {
        normalizedOrDefault(
            line.scaled(by: lineWeight)
                + forward.scaled(by: headingWeight)
                + normal.scaled(by: normalBias * sideSign)
        )
    }

    private static func normalizedOrDefault(_ vector: CGVector) -> CGVector {
        let length = max(vector.length, normalizationEpsilon)
        return CGVector(dx: vector.dx / length, dy: vector.dy / length)
    }

    private static func signedAngle(from lhs: CGVector, to rhs: CGVector) -> CGFloat {
        atan2((lhs.dx * rhs.dy) - (lhs.dy * rhs.dx), (lhs.dx * rhs.dx) + (lhs.dy * rhs.dy))
    }

    private struct MotionScoringContext {
        let metrics: MotionMetrics
        let startForward: CGVector
        let endForward: CGVector
        let preferredSide: Int

        var turnDemand: CGFloat {
            min(abs(HeadingDrivenCursorMotionModel.signedAngle(from: startForward, to: metrics.direction)) / .pi, 1)
        }

        var arrivalDemand: CGFloat {
            min(abs(HeadingDrivenCursorMotionModel.signedAngle(from: metrics.direction, to: endForward)) / .pi, 1)
        }

        var directness: CGFloat {
            (1 - max(turnDemand, arrivalDemand * 0.82)).clamped(to: 0...1)
        }
    }

    private struct MotionDescriptor {
        let id: String
        let family: String
        let side: Int
        let startReachScale: CGFloat
        let endReachScale: CGFloat
        let startLineWeight: CGFloat
        let endLineWeight: CGFloat
        let startHeadingWeight: CGFloat
        let endHeadingWeight: CGFloat
        let startNormalScale: CGFloat
        let endNormalScale: CGFloat
        let startGuideNormalBias: CGFloat
        let endGuideNormalBias: CGFloat
        let startFlowWeight: CGFloat
        let endFlowWeight: CGFloat
        let flowShift: CGFloat
        let arcScale: CGFloat
        let scoreBias: CGFloat

        var kind: CursorMotionKind {
            family == "direct" ? .base : .arched
        }
    }

    private struct MotionMetrics {
        let start: CGPoint
        let end: CGPoint
        let dx: CGFloat
        let dy: CGFloat
        let distance: CGFloat
        let direction: CGVector
        let normal: CGVector
        let horizontalFactor: CGFloat
        let verticalFactor: CGFloat
        let diagonalFactor: CGFloat
        let closeFactor: CGFloat
        let farFactor: CGFloat

        init(start: CGPoint, end: CGPoint) {
            self.start = start
            self.end = end
            dx = end.x - start.x
            dy = end.y - start.y
            distance = max(hypot(dx, dy), 1)
            direction = HeadingDrivenCursorMotionModel.normalizedOrDefault(CGVector(dx: dx, dy: dy))
            normal = HeadingDrivenCursorMotionModel.normalizedOrDefault(CGVector(dx: -direction.dy, dy: direction.dx))
            horizontalFactor = abs(dx) / distance
            verticalFactor = abs(dy) / distance
            diagonalFactor = min(horizontalFactor, verticalFactor) * 2
            closeFactor = (1 - (distance / 280)).clamped(to: 0...1)
            farFactor = ((distance - 180) / 540).clamped(to: 0...1)
        }
    }
}
