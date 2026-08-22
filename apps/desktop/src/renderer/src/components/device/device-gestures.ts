import type { DeviceTouchContact, DeviceTouchPhase } from '@superone/shared/device'
import type { NormalizedFramePoint } from './device-input'

export type IosSimulatorWheelGesture = 'scroll' | 'pinch' | 'rotate'

interface WheelGestureModifiers {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

interface ScrollUpdate {
  deltaX: number
  deltaY: number
  center: NormalizedFramePoint
}

interface TransformUpdate {
  scaleDelta: number
  rotationDeltaDegrees: number
  center: NormalizedFramePoint
  aspectRatio: number
}

type GestureMode = 'scroll' | 'transform'
type GestureFrames = DeviceTouchContact[][]

const INITIAL_RADIUS = 0.14
const MIN_RADIUS = 0.045
const MAX_RADIUS = 0.32
const EDGE_MARGIN = 0.02
const SCROLL_PIXELS_PER_SCREEN = 480
const SCALE_PER_PIXEL = 0.006

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function moved(contact: Omit<DeviceTouchContact, 'phase'>): DeviceTouchContact {
  return { ...contact, phase: 'moved' }
}

export function classifyDeviceWheelGesture(
  modifiers: WheelGestureModifiers,
): IosSimulatorWheelGesture {
  if (modifiers.altKey && modifiers.shiftKey) return 'rotate'
  if (modifiers.ctrlKey || modifiers.altKey) return 'pinch'
  return 'scroll'
}

/**
 * Converts semantic wheel/trackpad gestures into stable HID contact snapshots.
 * Pointer-driven touches stay in DeviceTouchTracker; callers must keep the
 * two trackers mutually exclusive while one owns the native contact slots.
 */
export class DeviceSyntheticGesture {
  private mode: GestureMode | null = null
  private center: NormalizedFramePoint = { xRatio: 0.5, yRatio: 0.5 }
  private scrollPoint: NormalizedFramePoint = { xRatio: 0.5, yRatio: 0.5 }
  private radius = INITIAL_RADIUS
  private angleRadians = 0
  private aspectRatio = 1

  get activeMode(): GestureMode | null { return this.mode }

  scroll(update: ScrollUpdate): GestureFrames {
    const frames = this.switchMode('scroll', update.center)
    this.scrollPoint = {
      xRatio: clamp(
        this.scrollPoint.xRatio - update.deltaX / SCROLL_PIXELS_PER_SCREEN,
        EDGE_MARGIN,
        1 - EDGE_MARGIN,
      ),
      yRatio: clamp(
        this.scrollPoint.yRatio - update.deltaY / SCROLL_PIXELS_PER_SCREEN,
        EDGE_MARGIN,
        1 - EDGE_MARGIN,
      ),
    }
    frames.push([moved({ id: 1, ...this.scrollPoint })])
    return frames
  }

  transform(update: TransformUpdate): GestureFrames {
    this.aspectRatio = clamp(update.aspectRatio, 0.1, 10)
    const frames = this.switchMode('transform', update.center)
    const boundedScaleDelta = clamp(update.scaleDelta, -50, 50)
    this.radius = clamp(
      this.radius * Math.exp(-boundedScaleDelta * SCALE_PER_PIXEL),
      MIN_RADIUS,
      MAX_RADIUS,
    )
    this.angleRadians += update.rotationDeltaDegrees * Math.PI / 180
    frames.push(this.transformContacts('moved'))
    return frames
  }

  end(): DeviceTouchContact[] | null { return this.finish('ended') }

  cancel(): DeviceTouchContact[] | null { return this.finish('cancelled') }

  /** Releases the contacts the active mode is holding. Null when there are none. */
  private finish(
    phase: Extract<DeviceTouchPhase, 'ended' | 'cancelled'>,
  ): DeviceTouchContact[] | null {
    if (this.mode === null) return null
    const contacts = this.mode === 'scroll'
      ? [{ id: 1, ...this.scrollPoint, phase }]
      : this.transformContacts(phase)
    this.reset()
    return contacts
  }

  private switchMode(mode: GestureMode, center: NormalizedFramePoint): GestureFrames {
    if (this.mode === mode) return []
    const frames: GestureFrames = []
    const ended = this.end()
    if (ended) frames.push(ended)

    this.mode = mode
    if (mode === 'scroll') {
      this.center = {
        xRatio: clamp(center.xRatio, 0.12, 0.88),
        yRatio: clamp(center.yRatio, 0.12, 0.88),
      }
      this.scrollPoint = { ...this.center }
      frames.push([{ id: 1, ...this.scrollPoint, phase: 'began' }])
      return frames
    }

    this.radius = INITIAL_RADIUS
    this.angleRadians = 0
    this.center = this.clampTransformCenter(center)
    frames.push(this.transformContacts('began'))
    return frames
  }

  private clampTransformCenter(center: NormalizedFramePoint): NormalizedFramePoint {
    const { xScale, yScale } = this.transformScales()
    const xMargin = MAX_RADIUS * xScale + EDGE_MARGIN
    const yMargin = MAX_RADIUS * yScale + EDGE_MARGIN
    return {
      xRatio: clamp(center.xRatio, xMargin, 1 - xMargin),
      yRatio: clamp(center.yRatio, yMargin, 1 - yMargin),
    }
  }

  private transformContacts(
    phase: Extract<DeviceTouchContact['phase'], 'began' | 'moved' | 'ended' | 'cancelled'>,
  ): DeviceTouchContact[] {
    const { xScale, yScale } = this.transformScales()
    const x = this.radius * xScale * Math.cos(this.angleRadians)
    const y = this.radius * yScale * Math.sin(this.angleRadians)
    return [
      { id: 1, xRatio: this.center.xRatio - x, yRatio: this.center.yRatio + y, phase },
      { id: 2, xRatio: this.center.xRatio + x, yRatio: this.center.yRatio - y, phase },
    ]
  }

  private transformScales(): { xScale: number; yScale: number } {
    return this.aspectRatio <= 1
      ? { xScale: 1, yScale: this.aspectRatio }
      : { xScale: 1 / this.aspectRatio, yScale: 1 }
  }

  private reset(): void {
    this.mode = null
    this.radius = INITIAL_RADIUS
    this.angleRadians = 0
  }
}
