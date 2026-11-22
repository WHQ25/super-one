import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, type ReplyComment } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { highlightBandsFromRects, type HighlightBand, type ViewportCorner } from '@/components/chat/plan-annotation-dom'
import { stickyForComment, stickyForDraft, type StickySwatch } from '@/components/chat/plan-sticky-palette'
import { MarkerStroke, StickyPinButton, markerBlendMode, strokeSeed } from '@/components/chat/plan-sticky-visuals'
import { getCodeCommentNote, openCodeCommentEdit, subscribeCodeCommentNote } from '@/components/chat/code-comment-note'
import { codeCommentAnchor, quoteMatchesFile } from '@/components/coding/code-comment-anchor'
import { visiblePinPosition } from '@/components/coding/code-comment-pin'

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

function rectsForLines(
  shadow: ShadowRoot,
  containerRect: DOMRect,
  lines: readonly number[],
): DOMRect[] {
  const rects: DOMRect[] = []
  for (const ln of lines) {
    const lineEl = shadow.querySelector<HTMLElement>(`[data-line="${ln}"]`)
    if (!lineEl) continue
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent || parent.closest('[data-column-number]')) return NodeFilter.FILTER_REJECT
        return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })
    let firstNode: Node | null = null
    let lastNode: Node | null = null
    let cur = walker.nextNode()
    while (cur) {
      if (!firstNode) firstNode = cur
      lastNode = cur
      cur = walker.nextNode()
    }
    if (!firstNode || !lastNode) continue
    const range = document.createRange()
    range.setStartBefore(firstNode)
    range.setEndAfter(lastNode)
    for (const r of Array.from(range.getClientRects())) {
      if (r.width <= 0 || r.height <= 0) continue
      rects.push(new DOMRect(r.left - containerRect.left, r.top - containerRect.top, r.width, r.height))
    }
  }
  return rects
}

export function ReviewStickyLayer({
  containerRef,
  fullPath,
  relPath,
  children,
}: {
  containerRef: RefObject<HTMLElement | null>
  fullPath: string
  relPath: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const comments = useActiveSession((s) => s.replyComments ?? EMPTY_COMMENTS)
  const note = useSyncExternalStore(subscribeCodeCommentNote, getCodeCommentNote, getCodeCommentNote)
  const [epoch, setEpoch] = useState(0)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [pins, setPins] = useState<Pin[]>([])
  const draftQuote = note?.mode === 'draft' ? note.quote : ''
  const editingId = note?.mode === 'edit' ? note.id ?? '' : ''

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const bump = () => setEpoch((n) => n + 1)
    const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null
    resizeObs?.observe(container)

    const shadow = container.querySelector('diffs-container')?.shadowRoot ?? null
    const mutObs = shadow && typeof MutationObserver !== 'undefined' ? new MutationObserver(bump) : null
    if (shadow && mutObs) mutObs.observe(shadow, { childList: true, subtree: true })

    return () => {
      resizeObs?.disconnect()
      mutObs?.disconnect()
    }
  }, [containerRef, fullPath, relPath])

  useLayoutEffect(() => {
    const container = containerRef.current
    const shadow = container?.querySelector('diffs-container')?.shadowRoot ?? null
    if (!container || !shadow) {
      setStrokes([])
      setPins([])
      return
    }
    const containerRect = container.getBoundingClientRect()
    const box = { left: 0, top: 0, width: containerRect.width, height: containerRect.height }
    const nextStrokes: Stroke[] = []
    const nextPins: Pin[] = []

    comments.forEach((comment, index) => {
      if (comment.surface !== 'code') return
      const anchor = codeCommentAnchor(comment.quote)
      if (!anchor || !quoteMatchesFile(anchor.filePath, fullPath, relPath)) return
      const rects = rectsForLines(shadow, containerRect, anchor.lines)
      if (rects.length === 0) return
      const swatch = stickyForComment(comment.id, comments)
      nextStrokes.push({ key: comment.id, bands: highlightBandsFromRects(rects), swatch })
      if (editingId !== comment.id) {
        const position = visiblePinPosition(rects, box, PIN)
        if (position) nextPins.push({ id: comment.id, index, swatch, position, comment })
      }
    })

    if (draftQuote) {
      const anchor = codeCommentAnchor(draftQuote)
      if (anchor && quoteMatchesFile(anchor.filePath, fullPath, relPath)) {
        const rects = rectsForLines(shadow, containerRect, anchor.lines)
        if (rects.length > 0) {
          nextStrokes.push({
            key: 'draft',
            bands: highlightBandsFromRects(rects),
            swatch: stickyForDraft(comments.length),
          })
        }
      }
    }

    setStrokes(nextStrokes)
    setPins(nextPins)
  }, [comments, draftQuote, editingId, epoch, containerRef, fullPath, relPath])

  return (
    <>
      {strokes.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-0">
          {strokes.map(({ key, bands, swatch }) => (
            <div key={key} className="pointer-events-none absolute inset-0" style={{ mixBlendMode: markerBlendMode(isDark) }}>
              {bands.map((band, i) => (
                <MarkerStroke
                  key={`${key}:${band.top}:${band.left}:${band.width}`}
                  band={band}
                  swatch={swatch}
                  isDark={isDark}
                  seed={strokeSeed(key, i)}
                  blend={false}
                  className="absolute"
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="relative z-[1]">{children}</div>
      {pins.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10">
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
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                openCodeCommentEdit(pin.comment, (rect?.left ?? 0) + pin.position.left, (rect?.top ?? 0) + pin.position.top)
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}
