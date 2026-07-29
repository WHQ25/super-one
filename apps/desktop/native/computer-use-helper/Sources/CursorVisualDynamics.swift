/** Software cursor visual spring dynamics from open-computer-use (MIT). */

import CoreGraphics
import Foundation

struct CursorVisualSpringConfiguration: Equatable {
    let response: CGFloat
    let dampingFraction: CGFloat
    let stiffness: CGFloat
    let drag: CGFloat
    let dt: CGFloat
    let idleVelocityThreshold: CGFloat

    init(
        response: CGFloat,
        dampingFraction: CGFloat,
        dt: CGFloat = 1.0 / 240.0,
        idleVelocityThreshold: CGFloat = 28_800
    ) {
        let rawStiffness = response > 0 ? pow((2 * .pi) / response, 2) : .infinity

        self.response = response
        self.dampingFraction = dampingFraction
        self.dt = dt
        self.idleVelocityThreshold = idleVelocityThreshold
        self.stiffness = min(rawStiffness, idleVelocityThreshold)
        self.drag = 2 * dampingFraction * sqrt(self.stiffness)
    }
}

struct CursorVisualDynamicsConfiguration: Equatable {
    let tipSpring: CursorVisualSpringConfiguration
    let angleSpring: CursorVisualSpringConfiguration
    let headingVelocityFloor: CGFloat
    let animatedAngleOffsetMax: CGFloat
    let bodyOffsetScale: CGFloat
    let bodyOffsetMax: CGFloat
    let bodyLateralScale: CGFloat
    let bodyLateralMax: CGFloat
    let fogOffsetScale: CGFloat
    let fogOffsetMax: CGFloat
    let fogOpacityBase: CGFloat
    let fogOpacityVelocityScale: CGFloat
    let fogScaleVelocityScale: CGFloat
    let fogScaleMaxDelta: CGFloat

    static let officialInspired = CursorVisualDynamicsConfiguration(
        tipSpring: CursorVisualSpringConfiguration(response: 0.18, dampingFraction: 0.76),
        angleSpring: CursorVisualSpringConfiguration(response: 0.24, dampingFraction: 0.82),
        headingVelocityFloor: 14,
        animatedAngleOffsetMax: 0.26,
        bodyOffsetScale: 0.0012,
        bodyOffsetMax: 2.4,
        bodyLateralScale: 0.06,
        bodyLateralMax: 1.4,
        fogOffsetScale: 0.0045,
        fogOffsetMax: 9,
        fogOpacityBase: 0.12,
        fogOpacityVelocityScale: 0.00006,
        fogScaleVelocityScale: 0.00012,
        fogScaleMaxDelta: 0.22
    )
}

struct CursorVisualDynamicsState: Equatable {
    var time: CGFloat
    var tipPosition: CGPoint
    var tipVelocity: CGVector
    var tipForce: CGVector
    var angle: CGFloat
    var angleVelocity: CGFloat
    var angleForce: CGFloat

    init(
        time: CGFloat = 0,
        tipPosition: CGPoint,
        tipVelocity: CGVector = CGVector(dx: 0, dy: 0),
        tipForce: CGVector = CGVector(dx: 0, dy: 0),
        angle: CGFloat = 0,
        angleVelocity: CGFloat = 0,
        angleForce: CGFloat = 0
    ) {
        self.time = time
        self.tipPosition = tipPosition
        self.tipVelocity = tipVelocity
        self.tipForce = tipForce
        self.angle = angle
        self.angleVelocity = angleVelocity
        self.angleForce = angleForce
    }
}

struct CursorVisualRenderState: Equatable {
    let tipPosition: CGPoint
    let rotation: CGFloat
    let cursorBodyOffset: CGVector
    let fogOffset: CGVector
    let fogOpacity: CGFloat
    let fogScale: CGFloat
}

enum CursorVisualDynamicsAnimator {
    static func state(at tipPosition: CGPoint, time: CGFloat = 0) -> CursorVisualDynamicsState {
        CursorVisualDynamicsState(time: time, tipPosition: tipPosition)
    }

    static func advance(
        state: CursorVisualDynamicsState,
        targetTipPosition: CGPoint,
        targetTime: CGFloat,
        idleAngleOffset: CGFloat = 0,
        baseHeading: CGFloat,
        renderYAxisMultiplier: CGFloat = 1,
        configuration: CursorVisualDynamicsConfiguration = .officialInspired
    ) -> (state: CursorVisualDynamicsState, renderState: CursorVisualRenderState) {
        var adjustedState = state

        if (targetTime - adjustedState.time) > 1 {
            adjustedState.time = targetTime - (1.0 / 60.0)
        }

        while adjustedState.time < targetTime {
            adjustedState = advanceStep(
                state: adjustedState,
                targetTipPosition: targetTipPosition,
                idleAngleOffset: idleAngleOffset,
                baseHeading: baseHeading,
                renderYAxisMultiplier: renderYAxisMultiplier,
                configuration: configuration
            )
        }

        return (
            adjustedState,
            renderState(
                state: adjustedState,
                idleAngleOffset: idleAngleOffset,
                baseHeading: baseHeading,
                renderYAxisMultiplier: renderYAxisMultiplier,
                configuration: configuration
            )
        )
    }

    private static func advanceStep(
        state: CursorVisualDynamicsState,
        targetTipPosition: CGPoint,
        idleAngleOffset: CGFloat,
        baseHeading: CGFloat,
        renderYAxisMultiplier: CGFloat,
        configuration: CursorVisualDynamicsConfiguration
    ) -> CursorVisualDynamicsState {
        let dt = configuration.tipSpring.dt
        let halfDT = dt * 0.5

        let tipVelocityHalf = state.tipVelocity + state.tipForce.scaled(by: halfDT)
        let nextTipPosition = state.tipPosition + tipVelocityHalf.scaled(by: dt)
        let tipDisplacement = targetTipPosition - nextTipPosition
        let tipForce = tipDisplacement.scaled(by: configuration.tipSpring.stiffness)
            + tipVelocityHalf.scaled(by: -configuration.tipSpring.drag)
        let tipVelocity = tipVelocityHalf + tipForce.scaled(by: halfDT)
        let renderVelocity = visualCursorScreenStateVelocity(
            fromRuntimeVelocity: tipVelocity,
            yAxisMultiplier: renderYAxisMultiplier
        )

        let targetAngle = resolvedTargetAngle(
            velocity: renderVelocity,
            idleAngleOffset: idleAngleOffset,
            baseHeading: baseHeading,
            configuration: configuration
        )
        let angleVelocityHalf = state.angleVelocity + (state.angleForce * halfDT)
        let nextAngle = normalizeAngle(state.angle + (angleVelocityHalf * dt))
        let angleError = normalizeAngle(targetAngle - nextAngle)
        let angleForce = (angleError * configuration.angleSpring.stiffness)
            + ((-configuration.angleSpring.drag) * angleVelocityHalf)
        let angleVelocity = angleVelocityHalf + (angleForce * halfDT)

        return CursorVisualDynamicsState(
            time: state.time + dt,
            tipPosition: nextTipPosition,
            tipVelocity: tipVelocity,
            tipForce: tipForce,
            angle: normalizeAngle(nextAngle),
            angleVelocity: angleVelocity,
            angleForce: angleForce
        )
    }

    private static func renderState(
        state: CursorVisualDynamicsState,
        idleAngleOffset: CGFloat,
        baseHeading: CGFloat,
        renderYAxisMultiplier: CGFloat,
        configuration: CursorVisualDynamicsConfiguration
    ) -> CursorVisualRenderState {
        let renderVelocity = visualCursorScreenStateVelocity(
            fromRuntimeVelocity: state.tipVelocity,
            yAxisMultiplier: renderYAxisMultiplier
        )
        let speed = renderVelocity.length
        let direction = speed > 0.001
            ? renderVelocity.normalized
            : CGVector(dx: cos(baseHeading + idleAngleOffset), dy: sin(baseHeading + idleAngleOffset))
        let bodyBackward = direction.scaled(
            by: -min(speed * configuration.bodyOffsetScale, configuration.bodyOffsetMax)
        )
        let lateralAmount = CGFloat.clamped(
            state.angleVelocity * configuration.bodyLateralScale,
            lower: -configuration.bodyLateralMax,
            upper: configuration.bodyLateralMax
        )
        let bodyLateral = direction.perpendicular.scaled(by: lateralAmount)
        let cursorBodyOffset = bodyBackward + bodyLateral
        let fogOffset = direction.scaled(
            by: -min(speed * configuration.fogOffsetScale, configuration.fogOffsetMax)
        ) + bodyLateral.scaled(by: 0.6)
        let fogOpacity = min(
            configuration.fogOpacityBase + (speed * configuration.fogOpacityVelocityScale),
            0.34
        )
        let fogScale = 1 + min(
            speed * configuration.fogScaleVelocityScale,
            configuration.fogScaleMaxDelta
        )

        return CursorVisualRenderState(
            tipPosition: state.tipPosition,
            rotation: normalizeAngle(
                state.angle + idleAngleOffset.clamped(
                    to: -configuration.animatedAngleOffsetMax...configuration.animatedAngleOffsetMax
                )
            ),
            cursorBodyOffset: cursorBodyOffset,
            fogOffset: fogOffset,
            fogOpacity: fogOpacity,
            fogScale: fogScale
        )
    }

    private static func resolvedTargetAngle(
        velocity: CGVector,
        idleAngleOffset: CGFloat,
        baseHeading: CGFloat,
        configuration: CursorVisualDynamicsConfiguration
    ) -> CGFloat {
        let speed = velocity.length
        guard speed > configuration.headingVelocityFloor else {
            return 0
        }

        let heading = atan2(velocity.dy, velocity.dx)
        return normalizeAngle(heading - baseHeading)
    }

    private static func normalizeAngle(_ angle: CGFloat) -> CGFloat {
        var value = angle
        while value > .pi {
            value -= 2 * .pi
        }
        while value < -.pi {
            value += 2 * .pi
        }
        return value
    }
}
