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
  getDraftMark,
  getMarkByCommentId,
  markTopRightViewport,
  quoteFromLines,
  type ViewportCorner,
} from './plan-annotation-dom'
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
  const [mdTick, setMdTick] = useState(0)
  const noteRef = useRef<OpenNote | null>(null)
  noteRef.current = note
  const saveNoteRef = useRef<(current: OpenNote) => void>(() => {})
  const markElsRef = useRef<Record<string, HTMLElement>>({})

  useEffect(() => {
    onSelectionChange?.(note != null)
  }, [note, onSelectionChange])

  const recomputePins = useCallback(() => {
    const next: Record<string, ViewportCorner> = {}
    for (const [id, mark] of Object.entries(markElsRef.current)) {
      const corner = markTopRightViewport(mark, PIN)
      if (corner) next[id] = corner
    }
    setPinPos(next)

    const open = noteRef.current
    if (!open) {
      setNotePos(null)
      return
    }
    let mark: HTMLElement | null = null
    if (open.mode === 'edit' && open.commentId) {
      mark = markElsRef.current[open.commentId] ?? null
    } else {
      mark = contentRef.current ? getDraftMark(contentRef.current) : null
    }
    if (mark) {
      const corner = markTopRightViewport(mark, PIN)
      // Open note hangs just under the pin
      setNotePos(corner ? { top: corner.top + PIN + 4, left: corner.left - 8 } : null)
    } else {
      setNotePos(null)
    }
  }, [])

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

  const pins = comments.map((c, index) => {
    if (note?.commentId === c.id) return null
    const pos = pinPos[c.id]
    if (!pos || !portalTarget) return null
    return createPortal(
      <button
        key={c.id}
        type="button"
        data-plan-sticky-ui
        aria-label={t('chat.plan.comments')}
        className={cn(
          'fixed z-[200] flex cursor-pointer items-center justify-center',
          'rounded-[2px] bg-[#facc15] text-[9px] font-semibold text-yellow-950/70',
          'shadow-[1px_1px_3px_rgba(0,0,0,0.28)]',
          'hover:brightness-105 dark:bg-yellow-500',
        )}
        style={{
          top: pos.top,
          left: pos.left,
          width: PIN,
          height: PIN,
        }}
        onClick={() => openExisting(c)}
      >
        {index + 1}
      </button>,
      portalTarget,
    )
  })

  const openNoteUi = note && portalTarget
    ? createPortal(
        <div
          data-plan-sticky-ui
          className="fixed z-[210]"
          style={{
            top: notePos?.top ?? 80,
            left: Math.max(8, Math.min(notePos?.left ?? 80, window.innerWidth - 200)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={cn(
              'relative w-48 rounded-[2px] bg-[#facc15] p-2.5 pt-5',
              'shadow-[2px_3px_8px_rgba(0,0,0,0.2)]',
              'dark:bg-yellow-500',
            )}
          >
            <button
              type="button"
              className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center text-yellow-950/40 hover:text-yellow-950"
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
              rows={3}
              value={note.text}
              onChange={(e) => setNote((n) => (n ? { ...n, text: e.target.value } : n))}
              onBlur={(e) => {
                const related = e.relatedTarget as HTMLElement | null
                if (related?.closest?.('[data-plan-sticky-ui]')) return
                const current = noteRef.current
                if (current) saveNoteRef.current(current)
              }}
              placeholder={t('chat.plan.commentPlaceholder')}
              className="w-full resize-none bg-transparent text-[13px] leading-snug text-yellow-950 placeholder:text-yellow-950/35 focus:outline-none"
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
      {pins}
      {openNoteUi}
    </div>
  )
}
