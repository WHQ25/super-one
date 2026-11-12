export interface Origin {
  left: number
  top: number
}

export interface ScrollerBox {
  left: number
  top: number
  right: number
  clientWidth: number
  scrollLeft: number
  scrollTop: number
}

/**
 * Top-left of the scroller's content, in screen coordinates, as if scroll were 0.
 * Same origin CodeMirror uses for `.cm-layer` markers, so a rect translated by
 * this origin stays put while the scroller moves.
 */
export function scrollContentOrigin(scroller: ScrollerBox, scaleX = 1, scaleY = 1, rtl = false): Origin {
  const leftEdge = rtl ? scroller.right - scroller.clientWidth * scaleX : scroller.left
  return {
    left: leftEdge - scroller.scrollLeft * scaleX,
    top: scroller.top - scroller.scrollTop * scaleY,
  }
}

export function translateRect(rect: DOMRectReadOnly, origin: Origin): DOMRect {
  return new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
}

/** Whitespace-only spans are not highlighter strokes. */
export function isBlankSpan(lineText: string, fromOff: number, toOff: number): boolean {
  return lineText.slice(Math.max(0, fromOff), Math.max(0, toOff)).trim() === ''
}
