/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { isBlankSpan, scrollContentOrigin, translateRect, type ScrollerBox } from './code-comment-geometry'

const scroller: ScrollerBox = { left: 100, top: 50, right: 500, clientWidth: 400, scrollLeft: 0, scrollTop: 0 }

describe('scrollContentOrigin', () => {
  it('keeps a highlight on the same text when the scroller moves', () => {
    const screen = new DOMRect(180, 90, 40, 20)
    const before = translateRect(screen, scrollContentOrigin(scroller))
    const scrolled = { ...scroller, scrollLeft: 30, scrollTop: 80 }
    const moved = new DOMRect(screen.left - 30, screen.top - 80, screen.width, screen.height)
    const after = translateRect(moved, scrollContentOrigin(scrolled))
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
  })

  it('measures from the right edge for RTL', () => {
    const origin = scrollContentOrigin({ ...scroller, scrollLeft: 10 }, 1, 1, true)
    expect(origin.left).toBe(scroller.right - scroller.clientWidth - 10)
    expect(origin.top).toBe(scroller.top)
  })
})

describe('isBlankSpan', () => {
  it('treats an empty or whitespace line as blank', () => {
    expect(isBlankSpan('', 0, 0)).toBe(true)
    expect(isBlankSpan('   ', 0, 3)).toBe(true)
  })

  it('keeps a line that has code', () => {
    expect(isBlankSpan('  const x = 1', 0, 13)).toBe(false)
    expect(isBlankSpan('}', 0, 1)).toBe(false)
  })
})
