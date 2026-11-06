import { describe, expect, it } from 'vitest'
import { annotatedImageBounds, computeCanvasBackingScale } from './image-editor-canvas'

describe('expanded image export bounds', () => {
  it('caps the preview backing store when a large image is zoomed out', () => {
    const scale = computeCanvasBackingScale(32000, 24000, 1100)
    expect(32000 * scale).toBeLessThanOrEqual(4800)
    expect(scale).toBeGreaterThan(0)
  })

  it('keeps the original extent when no annotation leaves the image', () => {
    expect(annotatedImageBounds(300, 200, [
      { id: 'line', kind: 'line', color: '#f00', strokeWidth: 2, x1: 20, y1: 20, x2: 80, y2: 80 },
    ])).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('includes stroke thickness on every side without including selection chrome', () => {
    expect(annotatedImageBounds(300, 200, [
      { id: 'pen', kind: 'pen', color: '#f00', strokeWidth: 4, points: [{ x: -30, y: -20 }, { x: 340, y: 240 }] },
    ])).toEqual({ x: -31, y: -21, width: 372, height: 262 })
  })

  it('includes rotated shapes and text instead of their unrotated frames', () => {
    const box = annotatedImageBounds(300, 200, [
      { id: 'box', kind: 'rect', color: '#f00', strokeWidth: 2, x: 260, y: 60, width: 20, height: 160, rotation: Math.PI / 2 },
    ])
    expect(box).toEqual({ x: 0, y: 0, width: 351, height: 200 })
    const text = annotatedImageBounds(300, 200, [
      { id: 'text', kind: 'text', color: '#f00', strokeWidth: 2, x: -50, y: -50, text: 'Outside', fontSize: 24, rotation: Math.PI / 4 },
    ])
    expect(text.x).toBeLessThan(-20)
    expect(text.y).toBeLessThan(-50)
  })

  it('does not enlarge the image for a mosaic outside existing pixels', () => {
    expect(annotatedImageBounds(300, 200, [
      { id: 'mosaic', kind: 'mosaic', x: -100, y: -100, width: 600, height: 400 },
    ])).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })
})
