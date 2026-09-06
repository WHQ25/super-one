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
  stickyForComment,
  stickyForDraft,
  type StickySwatch,
} from './plan-sticky-palette'
import {
  MARKER_OVERSHOOT,
  StickyPaper,
  StickyPinFace,
  markerStrokeStyle,
  strokeSeed,
} from './plan-sticky-visuals'
import { useIsDark } from '@/hooks/use-is-dark'
import { Z_CLASS } from '@/lib/z-layers'
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
  const isDark = useIsDark()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [note, setNote] = useState<OpenNote | null>(null)
  /** commentId → viewport pin corner */
  const [pinPos, setPinPos] = useState<Record<string, ViewportCorner>>({})
  const [notePos, setNotePos] = useState<ViewportCorner | null>(null)
  /** Continuous pen strokes (saved + draft) with per-comment highlighter color */
  const [strokeBands, setStrokeBands] = useState<
    Array<{ key: string; bands: HighlightBand[]; swatch: StickySwatch }>
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
    const strokes: Array<{ key: string; bands: HighlightBand[]; swatch: StickySwatch }> = []

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
            swatch: stickyForComment(c.id, comments),
          })
        }
      }
      const draftFragments = getDraftMarks(root)
      if (draftFragments.length) {
        strokes.push({
          key: '__draft__',
          bands: highlightBandsFromMarks(draftFragments),
          swatch: stickyForDraft(comments.length),
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

  const strokeLayers = portalTarget
    ? strokeBands.flatMap(({ key, bands, swatch }) =>
        bands.map((b, i) =>
          createPortal(
            <div
              key={`stroke-${key}-${i}`}
              aria-hidden
              className={cn('pointer-events-none fixed', Z_CLASS.PLAN_MARKER)}
              style={{
                top: b.top,
                left: b.left - MARKER_OVERSHOOT,
                width: Math.max(b.width, 8) + MARKER_OVERSHOOT * 2,
                height: b.height,
                ...markerStrokeStyle(swatch, isDark, strokeSeed(key, i)),
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
    const swatch = stickyForComment(c.id, comments)
    return createPortal(
      <button
        key={c.id}
        type="button"
        data-plan-sticky-ui
        aria-label={`${t('chat.plan.comments')} · ${swatch.label}`}
        className={cn(
          'fixed flex cursor-pointer items-center justify-center',
          Z_CLASS.PLAN_STICKY,
          'transition-[filter] hover:brightness-[1.06]',
        )}
        style={{
          top: pos.top,
          left: pos.left,
          transform: `rotate(${index % 2 === 0 ? -3 : 2.5}deg)`,
          filter: `drop-shadow(1px 1.5px 1.5px rgb(0 0 0 / ${isDark ? 0.5 : 0.28}))`,
        }}
        onClick={() => openExisting(c)}
      >
        <StickyPinFace swatch={swatch} isDark={isDark} index={index} size={PIN} />
      </button>,
      portalTarget,
    )
  })

  const openSwatch =
    note?.mode === 'edit' && note.commentId
      ? stickyForComment(note.commentId, comments)
      : stickyForDraft(comments.length)

  const openNoteUi = note && portalTarget
    ? createPortal(
        <div
          data-plan-sticky-ui
          className={cn('fixed', Z_CLASS.PLAN_NOTE)}
          style={{
            top: notePos?.top ?? 80,
            left: Math.max(8, Math.min(notePos?.left ?? 80, window.innerWidth - 220)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <StickyPaper swatch={openSwatch} isDark={isDark} width={202} minHeight={190}>
            <button
              type="button"
              className="absolute right-1.5 top-1 z-[1] flex size-5 items-center justify-center opacity-35 hover:opacity-80"
              style={{ color: openSwatch.text }}
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
              className="relative z-0 w-full resize-none bg-transparent text-xs leading-relaxed placeholder:opacity-40 focus:outline-none"
              style={{
                minHeight: 128,
                padding: '24px 16px 20px',
                color: openSwatch.text,
              }}
            />
          </StickyPaper>
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
