/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceFrameProjector, NormalizedFramePoint } from './device-input'
import { useDeviceInput } from './use-device-input'

const deviceInput = vi.fn(async (_deviceId: string, _input: unknown) => ({ ok: true }))

beforeEach(() => {
  deviceInput.mockClear()
  Object.defineProperty(window, 'environment', {
    configurable: true,
    value: { deviceInput },
  })
})

/** A 3D view's glass: only the pointers it says land on the device's front become touches. */
function glass(map: (x: number, y: number, clamp: boolean) => NormalizedFramePoint | null) {
  const element = document.createElement('div')
  document.body.append(element)
  const projector: DeviceFrameProjector = {
    element,
    point: map,
    delta: (deltaX, deltaY) => ({ deltaX, deltaY }),
    size: () => ({ width: 300, height: 600 }),
  }
  return projector
}

function pointer(clientX: number, clientY: number) {
  return {
    pointerId: 1, pointerType: 'mouse', button: 0, altKey: false, clientX, clientY,
    preventDefault: vi.fn(),
    currentTarget: { setPointerCapture: vi.fn(), getBoundingClientRect: () => new DOMRect(0, 0, 0, 0) },
  }
}

function mount(projector: DeviceFrameProjector) {
  return renderHook(() => useDeviceInput({
    deviceId: 'ios-sim:sim-a',
    enabled: true,
    canvas: null,
    projector,
  })).result.current
}

const touches = () => deviceInput.mock.calls
  .map(([, input]) => input as { type: string; contacts?: Array<{ phase: string; xRatio: number; yRatio: number }> })
  .filter((input) => input.type === 'touch.update')
  .flatMap((input) => input.contacts ?? [])

describe('useDeviceInput through a projector', () => {
  it('starts no touch where the pointer misses the glass, leaving the press to the view', () => {
    const { canvasHandlers } = mount(glass(() => null))
    const press = pointer(10, 10)
    canvasHandlers.onPointerDown(press as never)
    expect(deviceInput).not.toHaveBeenCalled()
    expect(press.preventDefault).not.toHaveBeenCalled()
  })

  it('touches the framebuffer point the glass maps the pointer to', () => {
    const { canvasHandlers } = mount(glass((x, y) => ({ xRatio: x / 1000, yRatio: y / 1000 })))
    canvasHandlers.onPointerDown(pointer(250, 750) as never)
    expect(touches()).toEqual([expect.objectContaining({ phase: 'began', xRatio: 0.25, yRatio: 0.75 })])
  })

  it('pins a drag that leaves the glass, and ends it at the last point when the glass turns away', () => {
    let facing = true
    const { canvasHandlers } = mount(glass((x, y, clamp) => {
      if (!facing) return null
      const point = { xRatio: x / 1000, yRatio: y / 1000 }
      if (point.xRatio > 1 && !clamp) return null
      return { xRatio: Math.min(1, point.xRatio), yRatio: point.yRatio }
    }))
    canvasHandlers.onPointerDown(pointer(900, 500) as never)
    canvasHandlers.onPointerMove(pointer(1200, 400) as never)
    facing = false
    canvasHandlers.onPointerUp(pointer(1300, 300) as never)
    expect(touches().at(-1)).toEqual(expect.objectContaining({ phase: 'ended', xRatio: 1, yRatio: 0.4 }))
  })

  it('takes the wheel only over the glass', () => {
    let onGlass = true
    const projector = glass(() => (onGlass ? { xRatio: 0.5, yRatio: 0.5 } : null))
    mount(projector)
    const over = new WheelEvent('wheel', { deltaY: 40, cancelable: true, bubbles: true })
    projector.element.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    onGlass = false
    const beside = new WheelEvent('wheel', { deltaY: 40, cancelable: true, bubbles: true })
    projector.element.dispatchEvent(beside)
    expect(beside.defaultPrevented).toBe(false)
  })
})
