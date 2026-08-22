import { describe, expect, it } from 'vitest'
import {
  DeviceSyntheticGesture,
  classifyDeviceWheelGesture,
} from './device-gestures'

const center = { xRatio: 0.5, yRatio: 0.5 }

describe('iOS Simulator synthetic gestures', () => {
  it('maps ordinary wheel movement to an inverse single-finger drag', () => {
    const gesture = new DeviceSyntheticGesture()
    const frames = gesture.scroll({ deltaX: 12, deltaY: 40, center })

    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual([
      { id: 1, phase: 'began', xRatio: 0.5, yRatio: 0.5 },
    ])
    expect(frames[1]?.[0]).toMatchObject({ id: 1, phase: 'moved' })
    expect(frames[1]![0]!.xRatio).toBeLessThan(0.5)
    expect(frames[1]![0]!.yRatio).toBeLessThan(0.5)
  })

  it('maps pinch input to a stable pair whose distance changes continuously', () => {
    const gesture = new DeviceSyntheticGesture()
    const first = gesture.transform({ scaleDelta: 20, rotationDeltaDegrees: 0, center, aspectRatio: 0.5 })
    const second = gesture.transform({ scaleDelta: -20, rotationDeltaDegrees: 0, center, aspectRatio: 0.5 })

    expect(first[0]).toEqual([
      { id: 1, phase: 'began', xRatio: 0.36, yRatio: 0.5 },
      { id: 2, phase: 'began', xRatio: 0.64, yRatio: 0.5 },
    ])
    expect(first[1]?.map((contact) => contact.id)).toEqual([1, 2])
    expect(second).toHaveLength(1)
    expect(second[0]![0]!.xRatio).toBeLessThan(first[1]![0]!.xRatio)
    expect(second[0]![1]!.xRatio).toBeGreaterThan(first[1]![1]!.xRatio)
  })

  it('rotates the active pair without changing its physical radius', () => {
    const gesture = new DeviceSyntheticGesture()
    gesture.transform({ scaleDelta: 0, rotationDeltaDegrees: 0, center, aspectRatio: 0.5 })
    const before = gesture.transform({ scaleDelta: 0, rotationDeltaDegrees: 0, center, aspectRatio: 0.5 })[0]!
    const after = gesture.transform({ scaleDelta: 0, rotationDeltaDegrees: 90, center, aspectRatio: 0.5 })[0]!

    expect(after[0]!.xRatio).toBeCloseTo(0.5)
    expect(after[1]!.xRatio).toBeCloseTo(0.5)
    expect(after[0]!.yRatio).toBeGreaterThan(0.5)
    expect(after[1]!.yRatio).toBeLessThan(0.5)

    const physicalRadius = (contacts: typeof before) => {
      const x = contacts[0]!.xRatio - 0.5
      const y = (contacts[0]!.yRatio - 0.5) / 0.5
      return Math.hypot(x, y)
    }
    expect(physicalRadius(after)).toBeCloseTo(physicalRadius(before))
  })

  it('ends every active contact together', () => {
    const gesture = new DeviceSyntheticGesture()
    gesture.transform({ scaleDelta: 0, rotationDeltaDegrees: 0, center, aspectRatio: 0.5 })

    expect(gesture.end()).toEqual([
      { id: 1, phase: 'ended', xRatio: 0.36, yRatio: 0.5 },
      { id: 2, phase: 'ended', xRatio: 0.64, yRatio: 0.5 },
    ])
    expect(gesture.end()).toBeNull()
  })

  it('classifies trackpad and mouse wheel modifiers without stealing normal scroll', () => {
    expect(classifyDeviceWheelGesture({ ctrlKey: false, altKey: false, shiftKey: false })).toBe('scroll')
    expect(classifyDeviceWheelGesture({ ctrlKey: true, altKey: false, shiftKey: false })).toBe('pinch')
    expect(classifyDeviceWheelGesture({ ctrlKey: false, altKey: true, shiftKey: false })).toBe('pinch')
    expect(classifyDeviceWheelGesture({ ctrlKey: false, altKey: true, shiftKey: true })).toBe('rotate')
  })
})
