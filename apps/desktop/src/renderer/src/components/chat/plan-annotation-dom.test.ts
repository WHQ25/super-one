/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  clearStickyMarks,
  highlightBandsFromMarks,
  quoteFromLines,
  STICKY_DRAFT_ATTR,
  STICKY_ID_ATTR,
  wrapRangeAsMarks,
} from './plan-annotation-dom'

describe('quoteFromLines', () => {
  const plan = '# Title\n\n- step A\n- step B'

  it('joins inclusive line span', () => {
    expect(quoteFromLines(plan, 3, 4)).toBe('- step A\n- step B')
  })

  it('returns empty when out of range', () => {
    expect(quoteFromLines(plan, 0, 1)).toBe('')
    expect(quoteFromLines(plan, 99, 100)).toBe('')
  })
})

describe('wrapRangeAsMarks (multi-line lists)', () => {
  function makeListDom() {
    const root = document.createElement('div')
    root.innerHTML = `
      <ul>
        <li>first item alpha</li>
        <li>second item beta</li>
        <li>third item gamma</li>
      </ul>
    `
    document.body.appendChild(root)
    return root
  }

  it('wraps each list item text separately without empty bullets', () => {
    const root = makeListDom()
    const lis = [...root.querySelectorAll('li')]
    const range = document.createRange()
    // From middle of first li through middle of third
    const t0 = lis[0]!.firstChild as Text
    const t2 = lis[2]!.firstChild as Text
    range.setStart(t0, 6) // "item alpha..."
    range.setEnd(t2, 11) // "...item g..."

    const marks = wrapRangeAsMarks(range, { id: 'c1' })
    expect(marks.length).toBeGreaterThanOrEqual(2)

    // List structure intact: still 3 <li>
    expect(root.querySelectorAll('li').length).toBe(3)
    // No empty list items
    for (const li of root.querySelectorAll('li')) {
      expect((li.textContent ?? '').trim().length).toBeGreaterThan(0)
    }
    // All marks share the same sticky id
    for (const m of root.querySelectorAll(`mark[${STICKY_ID_ATTR}]`)) {
      expect(m.getAttribute(STICKY_ID_ATTR)).toBe('c1')
    }

    clearStickyMarks(root)
    expect(root.querySelectorAll('mark').length).toBe(0)
    root.remove()
  })

  it('wraps draft marks with draft attr', () => {
    const root = makeListDom()
    const t = root.querySelector('li')!.firstChild as Text
    const range = document.createRange()
    range.setStart(t, 0)
    range.setEnd(t, 5)
    const marks = wrapRangeAsMarks(range, { draft: true })
    expect(marks).toHaveLength(1)
    expect(marks[0]!.hasAttribute(STICKY_DRAFT_ATTR)).toBe(true)
    root.remove()
  })
})

describe('highlightBandsFromMarks', () => {
  it('merges same-line bands with a small gap (code-chip bridge)', () => {
    // jsdom getClientRects is empty — stub via mock elements with rects
    const a = document.createElement('mark')
    const b = document.createElement('mark')
    // Patch getClientRects
    a.getClientRects = () =>
      [{ top: 100, left: 10, width: 40, height: 16, bottom: 116, right: 50, x: 10, y: 100, toJSON: () => ({}) }] as unknown as DOMRectList
    b.getClientRects = () =>
      [{ top: 101, left: 58, width: 50, height: 16, bottom: 117, right: 108, x: 58, y: 101, toJSON: () => ({}) }] as unknown as DOMRectList

    const bands = highlightBandsFromMarks([a, b], { gapMerge: 30, lineSlack: 4 })
    expect(bands).toHaveLength(1)
    expect(bands[0]!.left).toBe(10)
    expect(bands[0]!.width).toBe(98) // 10..108
    // uniform height (default strokeRatio 0.9)
    expect(bands[0]!.height).toBeCloseTo(16 * 0.9, 5)
  })
})
