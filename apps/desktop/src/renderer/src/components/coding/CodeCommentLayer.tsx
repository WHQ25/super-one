import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Direction, type EditorView } from '@codemirror/view'
import { useActiveSession, type ReplyComment } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { highlightBandsFromRects, type HighlightBand, type ViewportCorner } from '@/components/chat/plan-annotation-dom'
import { stickyForComment, stickyForDraft, type StickySwatch } from '@/components/chat/plan-sticky-palette'
import { MarkerStroke, StickyPinButton, markerBlendMode, strokeSeed } from '@/components/chat/plan-sticky-visuals'
import { getCodeCommentNote, openCodeCommentEdit, subscribeCodeCommentNote } from '@/components/chat/code-comment-note'
import { codeCommentAnchor, quoteMatchesFile } from './code-comment-anchor'
import { isBlankSpan, scrollContentOrigin, translateRect, type Origin } from './code-comment-geometry'
import { visiblePinPosition, type PinBox } from './code-comment-pin'

const PIN = 18
const EMPTY_COMMENTS: ReplyComment[] = []

interface Stroke {
  key: string
  bands: HighlightBand[]
  swatch: StickySwatch
}

interface Pin {
  id: string
  index: number
  swatch: StickySwatch
  position: ViewportCorner
  comment: ReplyComment
}

const EMPTY_BOX = { width: 0, height: 0 }

/** Screen origin of the editor, for pins that stay clamped to the visible code. */
function editorOrigin(view: EditorView): Origin {
  const rect = view.dom.getBoundingClientRect()
  return { left: rect.left, top: rect.top }
}

/** Screen origin of the unscrolled document, so strokes ride inside the scroller. */
function documentOrigin(view: EditorView): Origin {
  const rect = view.scrollDOM.getBoundingClientRect()
  return scrollContentOrigin(
    {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      clientWidth: view.scrollDOM.clientWidth,
      scrollLeft: view.scrollDOM.scrollLeft,
      scrollTop: view.scrollDOM.scrollTop,
    },
    view.scaleX || 1,
    view.scaleY || 1,
    view.textDirection === Direction.RTL,
  )
}

/** The scroller's on-screen code area, excluding the gutter and the minimap. */
function visibleCodeBox(view: EditorView): PinBox {
  const editor = view.dom.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const gutter = view.scrollDOM.querySelector('.cm-gutters')?.getBoundingClientRect()
  const left = gutter && gutter.width > 0 ? gutter.right : scroller.left
  return {
    left: left - editor.left,
    top: scroller.top - editor.top,
    width: Math.max(0, scroller.right - left),
    height: Math.max(0, scroller.height),
  }
}

function lineRect(
  view: EditorView,
  lineNo: number,
  startCol: number | null,
  endCol: number | null,
  first: boolean,
  last: boolean,
  origin: Origin,
): DOMRect | null {
  const doc = view.state.doc
  if (lineNo < 1 || lineNo > doc.lines) return null
  const line = doc.line(lineNo)
  const fromOff = first && startCol != null ? Math.min(Math.max(0, startCol), line.length) : 0
  const toOff = last && endCol != null ? Math.min(Math.max(fromOff, endCol), line.length) : line.length
  if (isBlankSpan(line.text, fromOff, toOff)) return null
  const from = line.from + fromOff
  const to = Math.max(from, line.from + toOff)
  try {
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to, -1)
    if (start && end && end.bottom > start.top && end.right > start.left) {
      return translateRect(new DOMRect(start.left, start.top, Math.max(8, end.right - start.left), end.bottom - start.top), origin)
    }
  } catch {
    // jsdom and offscreen lines have no geometry; the line-block fallback below still paints.
  }
  try {
    const block = view.lineBlockAt(line.from)
    const height = block.height > 0 ? block.height : (view.defaultLineHeight || 18)
    const screenTop = view.documentTop + (block.height > 0 ? block.top : (lineNo - 1) * height)
    const content = view.contentDOM.getBoundingClientRect()
    const pad = Number.parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0
    const charW = view.defaultCharacterWidth || 8
    const screenLeft = (content.width > 0 ? content.left : 0) + pad + fromOff * charW
    const width = Math.max(8, Math.max(1, toOff - fromOff) * charW)
    return translateRect(new DOMRect(screenLeft, screenTop, width, height), origin)
  } catch {
    const height = view.defaultLineHeight || 18
    const charW = view.defaultCharacterWidth || 8
    return new DOMRect(fromOff * charW, (lineNo - 1) * height, Math.max(8, Math.max(1, toOff - fromOff) * charW), height)
  }
}

function rectsForQuote(view: EditorView, quote: string, fullPath: string, relPath: string, origin: Origin): DOMRect[] {
  const anchor = codeCommentAnchor(quote)
  if (!anchor || !quoteMatchesFile(anchor.filePath, fullPath, relPath)) return []
  const first = anchor.lines[0]
  const last = anchor.lines[anchor.lines.length - 1]
  const rects: DOMRect[] = []
  for (const lineNo of anchor.lines) {
    const rect = lineRect(view, lineNo, anchor.startCol, anchor.endCol, lineNo === first, lineNo === last, origin)
    if (rect) rects.push(rect)
  }
  return rects
}

/**
 * Highlighter strokes and numbered pins for code comments on the open file.
 *
 * Strokes sit in the scroller, in document coordinates, so a scroll moves them
 * with the text. Pins hang on the top-right of the first code line.
 */
export function CodeCommentLayer({
  editorDom,
  viewRef,
  fullPath,
  relPath,
}: {
  editorDom: HTMLElement
  viewRef: RefObject<EditorView | null>
  fullPath: string
  relPath: string
}) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const comments = useActiveSession((s) => s.replyComments ?? EMPTY_COMMENTS)
  const note = useSyncExternalStore(subscribeCodeCommentNote, getCodeCommentNote, getCodeCommentNote)
  const [geometryEpoch, setGeometryEpoch] = useState(0)
  const [scrollEpoch, setScrollEpoch] = useState(0)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [strokeBox, setStrokeBox] = useState(EMPTY_BOX)
  const [pins, setPins] = useState<Pin[]>([])
  const draftQuote = note?.mode === 'draft' ? note.quote : ''
  const editingId = note?.mode === 'edit' ? note.id ?? '' : ''

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    let raf = 0
    // One update per frame, reading the latest scroll when it runs. Cancelling
    // the pending frame on every event held the pin until scrolling stopped.
    const schedulePins = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setScrollEpoch((n) => n + 1)
      })
    }
    const scheduleGeometry = () => {
      setGeometryEpoch((n) => n + 1)
      schedulePins()
    }
    view.scrollDOM.addEventListener('scroll', schedulePins, { passive: true })
    const observer = new ResizeObserver(scheduleGeometry)
    observer.observe(view.dom)
    observer.observe(view.contentDOM)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      view.scrollDOM.removeEventListener('scroll', schedulePins)
    }
  }, [editorDom, viewRef])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) {
      setStrokes([])
      setStrokeBox(EMPTY_BOX)
      return
    }
    const origin = documentOrigin(view)
    const next: Stroke[] = []
    for (const comment of comments) {
      if (comment.surface !== 'code') continue
      const rects = rectsForQuote(view, comment.quote, fullPath, relPath, origin)
      if (rects.length === 0) continue
      next.push({ key: comment.id, bands: highlightBandsFromRects(rects), swatch: stickyForComment(comment.id, comments) })
    }
    if (draftQuote) {
      const rects = rectsForQuote(view, draftQuote, fullPath, relPath, origin)
      if (rects.length > 0) {
        next.push({ key: 'draft', bands: highlightBandsFromRects(rects), swatch: stickyForDraft(comments.length) })
      }
    }
    setStrokes(next)
    setStrokeBox({ width: view.scrollDOM.scrollWidth, height: view.scrollDOM.scrollHeight })
  }, [comments, draftQuote, fullPath, geometryEpoch, relPath, viewRef])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) {
      setPins([])
      return
    }
    const origin = editorOrigin(view)
    const box = visibleCodeBox(view)
    const next: Pin[] = []
    comments.forEach((comment, index) => {
      if (comment.surface !== 'code' || editingId === comment.id) return
      const rects = rectsForQuote(view, comment.quote, fullPath, relPath, origin)
      if (rects.length === 0) return
      const position = visiblePinPosition(rects, box, PIN)
      if (position) next.push({ id: comment.id, index, swatch: stickyForComment(comment.id, comments), position, comment })
    })
    setPins(next)
  }, [comments, editingId, fullPath, geometryEpoch, relPath, scrollEpoch, viewRef])

  const openPin = (pin: Pin) => {
    const editor = viewRef.current?.dom.getBoundingClientRect()
    const x = (editor?.left ?? 0) + pin.position.left
    const y = (editor?.top ?? 0) + pin.position.top
    openCodeCommentEdit(pin.comment, x, y)
  }

  const scroller = editorDom.querySelector(':scope > .cm-scroller')
  // A zero box (jsdom) would clip every stroke. Real layout fills this in
  // useLayoutEffect before paint, and the scroller moves the box with the text.
  const sized = strokeBox.width > 0 && strokeBox.height > 0

  return (
    <>
      {scroller && createPortal(
        <div
          className="cm-comment-marks pointer-events-none absolute left-0 top-0"
          data-testid="code-comment-strokes"
          style={sized ? { width: strokeBox.width, height: strokeBox.height } : undefined}
        >
          {strokes.map(({ key, bands, swatch }) => (
            <div key={key} className="pointer-events-none absolute inset-0" style={{ mixBlendMode: markerBlendMode(isDark) }}>
              {bands.map((band, i) => (
                <MarkerStroke key={`${key}:${band.top}:${band.left}:${band.width}`} band={band} swatch={swatch} isDark={isDark} seed={strokeSeed(key, i)} blend={false} className="absolute" />
              ))}
            </div>
          ))}
        </div>,
        scroller,
      )}
      {createPortal(
        <div className="pointer-events-none absolute inset-0" data-testid="code-comment-layer">
          {pins.map((pin) => (
            <StickyPinButton
              key={pin.id}
              swatch={pin.swatch}
              isDark={isDark}
              index={pin.index}
              size={PIN}
              position={pin.position}
              label={`${t('chat.plan.comments')} · ${pin.swatch.label}`}
              className="pointer-events-auto absolute z-10"
              onClick={() => openPin(pin)}
            />
          ))}
        </div>,
        editorDom,
      )}
    </>
  )
}
