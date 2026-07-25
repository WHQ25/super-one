import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  selectionTextToLineRange,
  type PlanLineComment,
} from './plan-feedback'
import {
  applyStickyMarks,
  getDraftMarks,
  getMarkByCommentId,
  getMarksByCommentId,
  highlightBandsFromMarks,
  quoteFromLines,
  selectionTopRightViewport,
  type HighlightBand,
  type ViewportCorner,
} from './plan-annotation-dom'
import {
  highlighterForComment,
  highlighterForDraft,
  type HighlighterSwatch,
} from './plan-highlighter-colors'
import { CopyableMarkdown } from './CopyableMarkdown'

export interface PlanLineReviewProps {
  planContent: string
  comments: PlanLineComment[]
  onCommentsChange: (next: PlanLineComment[]) => void
  onSelectionChange?: (hasSelection: boolean) => void
  idPrefix: string
}

type OpenNote = {
  mode: 'create' | 'edit'
  commentId?: string
  startLine: number
  endLine: number
  quote: string
  text: string
}

const PIN = 18

/**
 * Plan sticky comments with **viewport-fixed** pins at the selection top-right
 * (first client rect of the highlight mark) — avoids scroll-container offset bugs.
 */
export function PlanLineReview({
  planContent,
  comments,
  onCommentsChange,
  onSelectionChange,
  idPrefix,
}: PlanLineReviewProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [note, setNote] = useState<OpenNote | null>(null)
  /** commentId → viewport pin corner */
  const [pinPos, setPinPos] = useState<Record<string, ViewportCorner>>({})
  const [notePos, setNotePos] = useState<ViewportCorner | null>(null)
  /** Continuous pen strokes (saved + draft) with per-comment highlighter color */
  const [strokeBands, setStrokeBands] = useState<
    Array<{ key: string; bands: HighlightBand[]; swatch: HighlighterSwatch }>
  >([])
  const [mdTick, setMdTick] = useState(0)
  const noteRef = useRef<OpenNote | null>(null)
  noteRef.current = note
  const saveNoteRef = useRef<(current: OpenNote) => void>(() => {})
  const markElsRef = useRef<Record<string, HTMLElement>>({})

  useEffect(() => {
    onSelectionChange?.(note != null)
  }, [note, onSelectionChange])

  const recomputePins = useCallback(() => {
    const root = contentRef.current
    const next: Record<string, ViewportCorner> = {}
    const strokes: Array<{ key: string; bands: HighlightBand[]; swatch: HighlighterSwatch }> = []

    if (root) {
      for (const c of comments) {
        const fragments = getMarksByCommentId(root, c.id)
        const corner = selectionTopRightViewport(fragments, PIN)
        if (corner) next[c.id] = corner
        const bands = highlightBandsFromMarks(fragments)
        if (bands.length) {
          strokes.push({
            key: c.id,
            bands,
            swatch: highlighterForComment(c.id, comments),
          })
        }
      }
      const draftFragments = getDraftMarks(root)
      if (draftFragments.length) {
        strokes.push({
          key: '__draft__',
          bands: highlightBandsFromMarks(draftFragments),
          swatch: highlighterForDraft(comments.length),
        })
      }
    }
    for (const [id, mark] of Object.entries(markElsRef.current)) {
      if (next[id]) continue
      const corner = selectionTopRightViewport([mark], PIN)
      if (corner) next[id] = corner
    }
    setPinPos(next)
    setStrokeBands(strokes)

    const open = noteRef.current
    if (!open || !root) {
      setNotePos(null)
      return
    }
    const fragments =
      open.mode === 'edit' && open.commentId
        ? getMarksByCommentId(root, open.commentId)
        : getDraftMarks(root)
    const corner = selectionTopRightViewport(fragments, PIN)
    setNotePos(corner ? { top: corner.top + PIN + 14, left: corner.left - 12 } : null)
  }, [comments])

  const reapplyMarksAndPins = useCallback(() => {
    const root = contentRef.current
    if (!root) return

    const open = noteRef.current
    const items = comments.map((c) => ({
      id: c.id,
      quote: c.quote?.trim() || quoteFromLines(planContent, c.startLine, c.endLine),
    }))
    const { marks, draftMark } = applyStickyMarks(
      root,
      items,
      open?.mode === 'create' ? open.quote : null,
    )
    markElsRef.current = marks
    if (open?.mode === 'edit' && open.commentId && !marks[open.commentId]) {
      const m = getMarkByCommentId(root, open.commentId)
      if (m) markElsRef.current[open.commentId] = m
    }
    void draftMark
    recomputePins()
  }, [comments, planContent, recomputePins])

  useLayoutEffect(() => {
    let cancelled = false
    const run = () => {
      if (!cancelled) reapplyMarksAndPins()
    }
    run()
    const t1 = window.setTimeout(run, 40)
    const t2 = window.setTimeout(run, 160)
    const t3 = window.setTimeout(run, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [reapplyMarksAndPins, mdTick, planContent, note?.quote, note?.mode, note?.commentId])

  // Keep fixed pins glued to marks while scrolling / resizing.
  useEffect(() => {
    const scrollEl = scrollRef.current
    const onMove = () => recomputePins()
    scrollEl?.addEventListener('scroll', onMove, { passive: true })
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    const ro = typeof ResizeObserver !== 'undefined' && scrollEl
      ? new ResizeObserver(onMove)
      : null
    if (scrollEl) ro?.observe(scrollEl)
    return () => {
      scrollEl?.removeEventListener('scroll', onMove)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      ro?.disconnect()
    }
  }, [recomputePins])

  const closeNote = useCallback(() => {
    setNote(null)
    setNotePos(null)
    window.getSelection()?.removeAllRanges()
    setMdTick((n) => n + 1)
  }, [])

  const openExisting = useCallback((c: PlanLineComment) => {
    setNote({
      mode: 'edit',
      commentId: c.id,
      startLine: c.startLine,
      endLine: c.endLine,
      quote: c.quote?.trim() || quoteFromLines(planContent, c.startLine, c.endLine),
      text: c.text,
    })
    requestAnimationFrame(() => {
      setMdTick((n) => n + 1)
      inputRef.current?.focus()
    })
  }, [planContent])

  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement | null)?.closest?.('mark[data-plan-sticky-id]') as HTMLElement | null
      if (!mark) return
      const id = mark.getAttribute('data-plan-sticky-id')
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      const c = comments.find((x) => x.id === id)
      if (c) openExisting(c)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [comments, mdTick, planContent, openExisting])

  const saveNote = useCallback((current: OpenNote) => {
    const text = current.text.trim()
    if (current.mode === 'edit' && current.commentId) {
      if (!text) {
        onCommentsChange(comments.filter((c) => c.id !== current.commentId))
      } else {
        onCommentsChange(
          comments.map((c) =>
            c.id === current.commentId
              ? { ...c, text, quote: current.quote || c.quote }
              : c,
          ),
        )
      }
    } else if (text) {
      const id = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      onCommentsChange([
        ...comments,
        {
          id,
          startLine: current.startLine,
          endLine: current.endLine,
          text,
          quote: current.quote,
        },
      ])
    }
    setNote(null)
    setNotePos(null)
    setMdTick((n) => n + 1)
  }, [comments, idPrefix, onCommentsChange])
  saveNoteRef.current = saveNote

  const removeComment = useCallback((id: string) => {
    onCommentsChange(comments.filter((c) => c.id !== id))
    if (note?.commentId === id) {
      setNote(null)
      setNotePos(null)
    }
    setMdTick((n) => n + 1)
  }, [comments, onCommentsChange, note?.commentId])

  const openCreateFromSelection = useCallback(() => {
    const root = contentRef.current
    if (!root) return
    if (note?.mode === 'edit') return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return
    if ((anchor as Node).parentElement?.closest?.('[data-plan-sticky-ui]')) return

    const quote = sel.toString().trim()
    if (!quote || quote.length < 2) return

    const lineRange =
      selectionTextToLineRange(planContent, quote)
      ?? { startLine: 1, endLine: 1 }

    if (note?.mode === 'create' && note.quote === quote) return

    setNote({
      mode: 'create',
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      quote,
      text: note?.mode === 'create' ? note.text : '',
    })
    sel.removeAllRanges()
    requestAnimationFrame(() => {
      setMdTick((n) => n + 1)
      inputRef.current?.focus()
    })
  }, [note, planContent])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onUp = (e: MouseEvent) => {
      if (!contentRef.current) return
      if (e.target instanceof Node && (e.target as HTMLElement).closest?.('[data-plan-sticky-ui]')) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => openCreateFromSelection(), 0)
    }
    document.addEventListener('mouseup', onUp, true)
    return () => {
      document.removeEventListener('mouseup', onUp, true)
      if (timer) clearTimeout(timer)
    }
  }, [openCreateFromSelection])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!note) return
      const active = document.activeElement
      const isNote =
        active instanceof HTMLTextAreaElement && active.dataset.planDraft !== undefined

      if (e.key === 'Enter') {
        if (isNote && (e.metaKey || e.ctrlKey) && !e.isComposing) {
          e.preventDefault()
          e.stopPropagation()
          saveNote(note)
          return
        }
        e.stopPropagation()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeNote()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [closeNote, note, saveNote])

  const portalTarget = typeof document !== 'undefined' ? document.body : null

  // Trapezoid pen tip: slight slant on both ends (like a real marker stroke)
  const penTrapezoid = 'polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%)'

  const strokeLayers = portalTarget
    ? strokeBands.flatMap(({ key, bands, swatch }) =>
        bands.map((b, i) =>
          createPortal(
            <div
              key={`stroke-${key}-${i}`}
              aria-hidden
              className="pointer-events-none fixed z-[198]"
              style={{
                top: b.top,
                left: b.left,
                width: Math.max(b.width, 8),
                height: b.height,
                clipPath: penTrapezoid,
                WebkitClipPath: penTrapezoid,
                background: `linear-gradient(
                  180deg,
                  ${swatch.coreTop} 0%,
                  ${swatch.core} 35%,
                  ${swatch.core} 70%,
                  ${swatch.coreBottom} 100%
                )`,
                boxShadow: `
                  0 0 0 0.5px ${swatch.edge},
                  0 0 6px 1px ${swatch.glow},
                  0 0 12px 2px ${swatch.bloom}
                `,
                mixBlendMode: 'screen',
              }}
            />,
            portalTarget,
          ),
        ),
      )
    : null

  const pins = comments.map((c, index) => {
    if (note?.commentId === c.id) return null
    const pos = pinPos[c.id]
    if (!pos || !portalTarget) return null
    const swatch = highlighterForComment(c.id, comments)
    return createPortal(
      <button
        key={c.id}
        type="button"
        data-plan-sticky-ui
        aria-label={`${t('chat.plan.comments')} · ${swatch.label}`}
        className={cn(
          'fixed z-[200] flex cursor-pointer items-center justify-center',
          'text-[9px] font-semibold hover:brightness-[1.03]',
        )}
        style={{
          top: pos.top,
          left: pos.left,
          width: PIN,
          height: PIN,
          color: `${swatch.ink}b3`,
          background: `linear-gradient(180deg, ${swatch.paper} 0%, ${swatch.paperDeep} 100%)`,
          boxShadow: '1px 1px 2px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.45)',
          borderRadius: 1,
        }}
        onClick={() => openExisting(c)}
      >
        {index + 1}
      </button>,
      portalTarget,
    )
  })

  const openSwatch =
    note?.mode === 'edit' && note.commentId
      ? highlighterForComment(note.commentId, comments)
      : highlighterForDraft(comments.length)

  const openNoteUi = note && portalTarget
    ? createPortal(
        <div
          data-plan-sticky-ui
          className="fixed z-[210]"
          style={{
            top: notePos?.top ?? 80,
            left: Math.max(8, Math.min(notePos?.left ?? 80, window.innerWidth - 220)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Paper sticky matching the highlighter color */}
          <div
            className="relative"
            style={{
              width: 200,
              minHeight: 168,
              padding: '22px 14px 14px',
              background: `linear-gradient(
                165deg,
                #FFFEF0 0%,
                ${openSwatch.paper} 18%,
                ${openSwatch.paper} 78%,
                ${openSwatch.paperDeep} 100%
              )`,
              boxShadow: `
                1px 1px 0 rgba(0,0,0,0.04),
                2px 3px 2px rgba(0,0,0,0.06),
                3px 8px 18px rgba(0,0,0,0.14)
              `,
              transform: 'rotate(1.25deg)',
              borderRadius: 1,
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-3"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 100%)',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 top-0"
              style={{
                width: 0,
                height: 0,
                borderStyle: 'solid',
                borderWidth: '0 18px 18px 0',
                borderColor: `transparent ${openSwatch.paperDeep} transparent transparent`,
                filter: 'drop-shadow(-1px 1px 0 rgba(0,0,0,0.06))',
              }}
            />
            <button
              type="button"
              className="absolute right-1 top-1 z-[1] flex size-5 items-center justify-center opacity-40 hover:opacity-80"
              style={{ color: openSwatch.ink }}
              aria-label={
                note.mode === 'edit'
                  ? t('chat.plan.removeComment')
                  : t('chat.plan.cancelComment')
              }
              onClick={() => {
                if (note.mode === 'edit' && note.commentId) {
                  removeComment(note.commentId)
                } else {
                  closeNote()
                }
              }}
            >
              <X className="size-3.5" strokeWidth={2.25} />
            </button>
            <textarea
              ref={inputRef}
              data-plan-draft
              rows={5}
              value={note.text}
              onChange={(e) => setNote((n) => (n ? { ...n, text: e.target.value } : n))}
              onBlur={(e) => {
                const related = e.relatedTarget as HTMLElement | null
                if (related?.closest?.('[data-plan-sticky-ui]')) return
                const current = noteRef.current
                if (current) saveNoteRef.current(current)
              }}
              placeholder={t('chat.plan.commentPlaceholder')}
              className="relative z-0 w-full resize-none bg-transparent text-[13px] leading-relaxed placeholder:opacity-40 focus:outline-none"
              style={{
                minHeight: 112,
                color: openSwatch.ink,
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
              }}
            />
          </div>
        </div>,
        portalTarget,
      )
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {planContent.trim().length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t('chat.plan.emptyPlan')}</div>
        ) : (
          <div ref={contentRef} className="select-text px-4 py-3">
            <CopyableMarkdown text={planContent} isStreaming={false} />
          </div>
        )}
      </div>
      {strokeLayers}
      {pins}
      {openNoteUi}
    </div>
  )
}
