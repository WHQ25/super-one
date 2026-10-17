/** @vitest-environment jsdom */
import { Group, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { attachDeviceModelTurntable } from './device-model-turntable'

function pointer(type: string, x: number, y: number, init: { shiftKey?: boolean } = {}) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, shiftKey: init.shiftKey, bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

function setup() {
  const element = document.createElement('div')
  element.setPointerCapture = vi.fn()
  const target = new Group()
  const onChange = vi.fn()
  const canStart = vi.fn(() => true)
  const turntable = attachDeviceModelTurntable(element, target, { canStart, onChange })
  const drag = (path: Array<[number, number]>, shiftKey = false) => {
    element.dispatchEvent(pointer('pointerdown', ...path[0]!))
    for (const [x, y] of path.slice(1)) element.dispatchEvent(pointer('pointermove', x, y, { shiftKey }))
    element.dispatchEvent(pointer('pointerup', ...path.at(-1)!))
  }
  // Where the body's own up and right point once turned.
  const axes = () => ({
    up: new Vector3(0, 1, 0).applyQuaternion(target.quaternion),
    right: new Vector3(1, 0, 0).applyQuaternion(target.quaternion),
  })
  return { element, target, onChange, canStart, turntable, drag, axes }
}

describe('device model turntable', () => {
  it('never leans the body however sideways and up-and-down drags are mixed', () => {
    const { drag, axes } = setup()
    drag([[0, 0], [40, 30], [-20, 80], [90, -60], [10, 10]])

    // A lean is the body's own up axis tilting sideways on screen. Spinning about that
    // axis and tipping about the view's horizontal both keep it in the vertical plane.
    expect(axes().up.x).toBeCloseTo(0, 6)
  })

  it('tips over the top without stopping, and rolls only with Shift held', () => {
    const { drag, axes } = setup()
    drag([[0, 0], [0, 360]])
    // Half a turn tipped: upside down, not pinned at the top.
    expect(axes().up.y).toBeCloseTo(-1, 6)

    const rolled = setup()
    rolled.drag([[0, 0], [90, 0]], true)
    expect(rolled.axes().up.z).toBeCloseTo(0, 6)
    expect(Math.abs(rolled.axes().up.x)).toBeGreaterThan(0.5)
  })

  it('leaves a press the glass claims alone, and resets to facing the camera', () => {
    const { drag, target, canStart, turntable } = setup()
    canStart.mockReturnValue(false)
    drag([[0, 0], [100, 100]])
    expect(target.quaternion.w).toBeCloseTo(1, 6)

    canStart.mockReturnValue(true)
    drag([[0, 0], [100, 100]])
    turntable.reset()
    expect(target.quaternion.w).toBeCloseTo(1, 6)
    expect(turntable.zoom()).toBe(1)
  })
})
