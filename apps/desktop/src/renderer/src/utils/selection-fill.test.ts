/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './selection-fill'

function select(text: Text, start: number, end: number): Range {
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  return range
}

/** jsdom leaves Range#getClientRects off the prototype, so install one for the glyph path. */
function mockGlyphRect(rect: DOMRect): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [rect] as unknown as DOMRectList,
  })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 200, 20)] as unknown as DOMRectList)
})
afterEach(() => {
  document.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  document.body.replaceChildren()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Range.prototype, 'getClientRects')
})

describe('atomic chip selection fill', () => {
  it('paints the whole chip for a partial title selection without changing the selected range', () => {
    document.body.innerHTML = '<p class="chat-md"><a data-selection-fill data-selection-atomic style="display:inline-flex"><span aria-hidden="true">icon</span><span>Long title</span></a></p>'
    const chip = document.querySelector('a')!
    const text = chip.lastElementChild!.firstChild as Text
    const range = select(text, 2, 5)
    expect(chip.classList.contains('selection-filled--box')).toBe(true)
    expect(document.getSelection()!.toString()).toBe('ng ')
    expect(range.startContainer).toBe(text)
    expect(range.startOffset).toBe(2)
    expect(range.endOffset).toBe(5)
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    expect(chip.classList.contains('selection-filled')).toBe(false)
  })

  it('keeps ordinary links partially selected until their whole text is covered', () => {
    document.body.innerHTML = '<p class="chat-md"><a style="display:inline">Web title</a></p>'
    const link = document.querySelector('a')!
    select(link.firstChild as Text, 1, 3)
    expect(link.classList.contains('selection-filled')).toBe(false)
    select(link.firstChild as Text, 0, 9)
    expect(link.classList.contains('selection-filled')).toBe(true)
  })
})

describe('list marker selection fill', () => {
  it('ends the marker strip at a leading chip and spans the item line', () => {
    document.body.innerHTML = '<ul class="chat-md"><li style="padding:0;border:0 solid;line-height:24px"><span data-selection-fill data-selection-atomic style="display:inline-flex;margin:0"><svg></svg><span style="display:block;line-height:16px">file.ts</span></span> tail</li></ul>'
    const li = document.querySelector('li')!
    const chip = li.firstElementChild as HTMLElement
    vi.spyOn(li, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 24))
    vi.spyOn(chip, 'getClientRects').mockReturnValue([new DOMRect(24, 2, 150, 20)] as unknown as DOMRectList)
    const range = document.createRange()
    range.setStart(chip.lastElementChild!.firstChild!, 0)
    range.setEnd(li.lastChild!, 5)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    expect(li.classList.contains('selection-marker')).toBe(true)
    expect(li.style.getPropertyValue('--marker-width')).toBe('24px')
    expect(li.style.getPropertyValue('--marker-top')).toBe('0px')
    expect(li.style.getPropertyValue('--marker-height')).toBe('24px')
  })

  /** Code border box starts at 30 with 6px margin; the first glyph is at 48, inside the padding. */
  function mountLeadingCode(): { li: HTMLElement; code: HTMLElement } {
    document.body.innerHTML = '<ul class="chat-md"><li style="padding:0;border:0 solid;line-height:24px"><code style="display:inline;margin-left:6px;padding-left:4px">apps</code> tail</li></ul>'
    const li = document.querySelector('li')!
    const code = li.querySelector('code')!
    vi.spyOn(li, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 24))
    vi.spyOn(code, 'getClientRects').mockReturnValue([new DOMRect(30, 2, 80, 18)] as unknown as DOMRectList)
    mockGlyphRect(new DOMRect(48, 4, 10, 14))
    return { li, code }
  }

  it('ends the marker strip at a leading inline code, not inside its padding', () => {
    const { li, code } = mountLeadingCode()
    const range = document.createRange()
    range.setStart(code.firstChild!, 0)
    range.setEnd(li.lastChild!, 5)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    expect(li.classList.contains('selection-marker')).toBe(true)
    expect(code.classList.contains('selection-filled')).toBe(true)
    expect(li.style.getPropertyValue('--marker-width')).toBe('24px')
  })

  it('keeps that edge when the leading inline code is only partly selected', () => {
    const { li, code } = mountLeadingCode()
    select(code.firstChild as Text, 0, 2)
    expect(code.classList.contains('selection-filled')).toBe(false)
    expect(li.style.getPropertyValue('--marker-width')).toBe('24px')
  })
})
