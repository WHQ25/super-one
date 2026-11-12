/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { visiblePinPosition } from './code-comment-pin'

const PIN = 18
const view = { left: 40, top: 8, width: 320, height: 200 }

describe('visiblePinPosition', () => {
  it('hangs on the top-right corner of the first line', () => {
    const rects = [new DOMRect(80, 40, 60, 22)]
    expect(visiblePinPosition(rects, view, PIN)).toEqual({
      left: 80 + 60 - PIN / 2,
      top: 40 - PIN / 2,
    })
  })

  it('ignores a later long line and stays on the first line', () => {
    const rects = [new DOMRect(80, 40, 40, 22), new DOMRect(80, 70, 2400, 22)]
    expect(visiblePinPosition(rects, view, PIN)).toEqual({
      left: 80 + 40 - PIN / 2,
      top: 40 - PIN / 2,
    })
  })

  it('pulls a long first line back to the visible right edge', () => {
    const rects = [new DOMRect(80, 64, 2400, 22)]
    expect(visiblePinPosition(rects, view, PIN)).toEqual({
      left: view.left + view.width - PIN,
      top: 64 - PIN / 2,
    })
  })

  it('sticks to the visible top when the first line has scrolled above', () => {
    const rects = [new DOMRect(80, -400, 60, 22)]
    const pin = visiblePinPosition(rects, view, PIN)
    expect(pin?.top).toBe(view.top)
    expect(pin?.left).toBe(80 + 60 - PIN / 2)
  })

  it('returns null when there is no selection', () => {
    expect(visiblePinPosition([], view, PIN)).toBeNull()
  })
})
