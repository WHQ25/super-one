import { describe, expect, it } from 'vitest'
import { normalizeFramePoint, rotateFrameDelta, unrotateFrameSize } from './device-input'

describe('normalizeFramePoint', () => {
  const bounds = { left: 100, top: 50, width: 200, height: 400 }

  it('maps pointer coordinates into framebuffer ratios', () => {
    expect(normalizeFramePoint(bounds, 150, 250)).toEqual({ xRatio: 0.25, yRatio: 0.5 })
  })

  it('clamps coordinates to the visible framebuffer', () => {
    expect(normalizeFramePoint(bounds, 50, 500)).toEqual({ xRatio: 0, yRatio: 1 })
  })

  it('handles an image before layout without producing invalid numbers', () => {
    expect(normalizeFramePoint({ ...bounds, width: 0 }, 150, 250)).toEqual({ xRatio: 0, yRatio: 0 })
  })

  // A quarter turn hands back the bounding box with width and height swapped, so
  // these bounds describe a device that is still 200x400 in its own space.
  const landscape = { left: 100, top: 50, width: 400, height: 200 }

  it('undoes a quarter turn so the device top-left stays the device top-left', () => {
    // Rotated 90deg clockwise, the device's top-left corner sits top-right on screen.
    expect(normalizeFramePoint(landscape, 500, 50, 90)).toEqual({ xRatio: 0, yRatio: 0 })
    expect(normalizeFramePoint(landscape, 100, 250, 90)).toEqual({ xRatio: 1, yRatio: 1 })
  })

  it('undoes a three-quarter turn', () => {
    expect(normalizeFramePoint(landscape, 100, 250, 270)).toEqual({ xRatio: 0, yRatio: 0 })
    expect(normalizeFramePoint(landscape, 500, 50, 270)).toEqual({ xRatio: 1, yRatio: 1 })
  })

  it('undoes a half turn without swapping the axes', () => {
    // The mirror of the upright case: (0.25, 0.5) upside down is (0.75, 0.5) on screen.
    expect(normalizeFramePoint(bounds, 250, 250, 180)).toEqual({ xRatio: 0.25, yRatio: 0.5 })
  })

  it('keeps the centre at the centre for every orientation', () => {
    for (const degrees of [0, 90, 180, 270]) {
      const box = degrees % 180 === 0 ? bounds : landscape
      expect(normalizeFramePoint(box, box.left + box.width / 2, box.top + box.height / 2, degrees))
        .toEqual({ xRatio: 0.5, yRatio: 0.5 })
    }
  })
})

describe('rotateFrameDelta', () => {
  it('leaves an upright device alone', () => {
    expect(rotateFrameDelta(3, -7)).toEqual({ deltaX: 3, deltaY: -7 })
  })

  it('turns a downward scroll into the device axis it now points along', () => {
    expect(rotateFrameDelta(0, 10, 90)).toEqual({ deltaX: 10, deltaY: -0 })
    expect(rotateFrameDelta(0, 10, 270)).toEqual({ deltaX: -10, deltaY: 0 })
    expect(rotateFrameDelta(0, 10, 180)).toEqual({ deltaX: -0, deltaY: -10 })
  })
})

describe('unrotateFrameSize', () => {
  it('recovers the device size from the rotated bounding box', () => {
    const landscape = { left: 0, top: 0, width: 400, height: 200 }
    expect(unrotateFrameSize(landscape, 90)).toEqual({ width: 200, height: 400 })
    expect(unrotateFrameSize(landscape, 180)).toEqual({ width: 400, height: 200 })
  })
})
