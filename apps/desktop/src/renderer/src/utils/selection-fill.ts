/**
 * Read-only chat content: inline code, file chips and bubble mention chips carry
 * padding, a fill or `user-select: none`, so the native highlight leaves gaps
 * around them. Inline code and elements marked `data-selection-fill` take part:
 * while one lies fully inside the selection it gets `.selection-filled` and CSS
 * paints it in the selection colour out to its line box (styles/index.css).
 * Atomic copy targets fill on any intersection, matching their full-chip copy.
 * Layout never moves:
 * an inline box grows by padding that replaces its margins and only extends
 * vertically; an atomic box (inline-flex/-block) paints a ::before behind itself,
 * reaching its line box; a block lays a tint over itself, children included.
 * Composer chips are handled inside the editor by ChipSelection.
 */
import { coversMarker } from './selection-markdown'

const FILLED = 'selection-filled'
const MARKER = 'selection-marker'
const MARKER_VARS = ['--marker-left', '--marker-top', '--marker-width', '--marker-height']
const INLINE = 'selection-filled--inline'
const BOX = 'selection-filled--box'
const BLOCK = 'selection-filled--block'
const VARS = ['--fill-top', '--fill-bottom', '--fill-left', '--fill-right']
const TARGETS = [
  '[data-selection-fill]',
  ':not(pre) > code',
  // A link fills whole, so its favicon is part of the run.
  '.chat-md a',
  // Blocks with their own chrome (header, borders, fill) light up entirely.
  '.chat-md [data-chat-codeblock]',
  '.chat-md [data-streamdown="table-wrapper"]',
  '.chat-md .katex-display',
].join(', ')

let filled: HTMLElement[] = []
let marked: HTMLElement[] = []

/**
 * The line box `rect` sits on, in the nearest block at or above `from`,
 * assuming the block's lines share one line-height.
 */
function lineBox(from: Element | null, rect: DOMRect): { top: number; bottom: number } | null {
  let block = from
  while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement
  if (!block) return null
  const style = getComputedStyle(block)
  const lineHeight = parseFloat(style.lineHeight)
  if (!Number.isFinite(lineHeight)) return null
  const contentTop = block.getBoundingClientRect().top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
  const top = contentTop + Math.floor((rect.top + rect.height / 2 - contentTop) / lineHeight) * lineHeight
  return { top, bottom: top + lineHeight }
}

function fill(el: HTMLElement): void {
  const rect = el.getClientRects()[0]
  if (!rect) return
  const line = lineBox(el.parentElement, rect) ?? { top: rect.top, bottom: rect.bottom }
  const style = getComputedStyle(el)
  const px = (name: string): number => parseFloat(style.getPropertyValue(name))
  const set = (name: string, value: number): void => el.style.setProperty(name, `${Math.max(0, value)}px`)
  if (style.display === 'inline') {
    // Padding totals measured from the content box, so re-filling a filled element is stable.
    set('--fill-top', rect.top + px('border-top-width') + px('padding-top') - line.top)
    set('--fill-bottom', line.bottom - (rect.bottom - px('border-bottom-width') - px('padding-bottom')))
    set('--fill-left', px('padding-left') + px('margin-left'))
    set('--fill-right', px('padding-right') + px('margin-right'))
    el.classList.add(INLINE)
  } else if (style.display.startsWith('inline')) {
    set('--fill-top', rect.top - line.top)
    set('--fill-bottom', line.bottom - rect.bottom)
    set('--fill-left', px('margin-left'))
    set('--fill-right', px('margin-right'))
    el.classList.add(BOX)
  } else {
    el.classList.add(BLOCK)
  }
  el.classList.add(FILLED)
}

/**
 * Whether the range spans all of the element's text. Not `containsNode`: the
 * browser parks a selection that ends at a chip's edge on its last character,
 * inside the chip, so the chip never counts as contained.
 */
function covers(range: Range, el: HTMLElement): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  let last = first
  for (let node = first; node; node = walker.nextNode()) last = node
  const inner = document.createRange()
  if (first && last) {
    inner.setStart(first, 0)
    inner.setEnd(last, last.textContent?.length ?? 0)
  } else {
    inner.selectNode(el)
  }
  return range.compareBoundaryPoints(Range.START_TO_START, inner) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, inner) >= 0
}

/**
 * A list marker (`::marker`) is not content, so the browser never highlights
 * it. When the selection spans an item's start, paint the strip from the
 * item's content edge to its first character, where an inside marker sits.
 */
function markItem(li: HTMLElement, text: Text): void {
  const first = document.createRange()
  first.setStart(text, 0)
  first.setEnd(text, Math.min(1, text.length))
  const rect = first.getClientRects()[0]
  if (!rect) return
  const box = li.getBoundingClientRect()
  const style = getComputedStyle(li)
  const contentLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
  const line = lineBox(text.parentElement, rect) ?? { top: rect.top, bottom: rect.bottom }
  li.style.setProperty('--marker-left', `${contentLeft - box.left}px`)
  li.style.setProperty('--marker-width', `${Math.max(0, rect.left - contentLeft)}px`)
  li.style.setProperty('--marker-top', `${line.top - box.top}px`)
  li.style.setProperty('--marker-height', `${line.bottom - line.top}px`)
  li.classList.add(MARKER)
}

function unmarkItem(li: HTMLElement): void {
  li.classList.remove(MARKER)
  for (const name of MARKER_VARS) li.style.removeProperty(name)
}

function unfill(el: HTMLElement): void {
  el.classList.remove(FILLED, INLINE, BOX, BLOCK)
  for (const name of VARS) el.style.removeProperty(name)
}

function sync(): void {
  const selection = document.getSelection()
  const next: HTMLElement[] = []
  const nextMarked: Array<[HTMLElement, Text]> = []
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    const common = range.commonAncestorContainer
    const scope = common instanceof Element ? common : common.parentElement
    if (scope && !scope.closest('[contenteditable="true"]')) {
      const own = scope.closest<HTMLElement>(TARGETS)
      for (const el of [...(own ? [own] : []), ...scope.querySelectorAll<HTMLElement>(TARGETS)]) {
        if (el.hasAttribute('data-selection-atomic') ? range.intersectsNode(el) : covers(range, el)) next.push(el)
      }
      const item = scope.closest<HTMLElement>('.chat-md li')
      for (const li of [...(item ? [item] : []), ...scope.querySelectorAll<HTMLElement>('.chat-md li')]) {
        const text = coversMarker(range, li)
        if (text) nextMarked.push([li, text])
      }
    }
  }
  // A target inside another filled one (code in a link, a chip in a table) is
  // already covered; filling both would stack the translucent colour.
  const outer = next.filter((el) => !next.some((other) => other !== el && other.contains(el)))
  for (const el of filled) if (!outer.includes(el)) unfill(el)
  for (const el of outer) fill(el)
  filled = outer
  for (const li of marked) if (!nextMarked.some(([item]) => item === li)) unmarkItem(li)
  for (const [li, text] of nextMarked) markItem(li, text)
  marked = nextMarked.map(([li]) => li)
}

document.addEventListener('selectionchange', sync)
