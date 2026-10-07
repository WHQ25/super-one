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

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 200, 20)] as unknown as DOMRectList)
})
afterEach(() => {
  document.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  document.body.replaceChildren()
  vi.restoreAllMocks()
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
