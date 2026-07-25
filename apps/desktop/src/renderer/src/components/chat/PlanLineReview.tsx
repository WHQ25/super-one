import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  selectionTextToLineRange,
  type PlanLineComment,
} from './plan-feedback'
import {
  anchorBesideMark,
  applyStickyMarks,
  getDraftMark,
  getMarkByCommentId,
  quoteFromLines,
  type StickyAnchor,
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

/**
 * Simple post-it plan comments:
 * select text → yellow mark + sticky note (textarea).
 * Saved notes collapse to a pin; click opens direct edit; top-right X deletes / closes.
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
  const [anchors, setAnchors] = useState<Record<string, StickyAnchor>>({})
  const [noteAnchor, setNoteAnchor] = useState<StickyAnchor | null>(null)
  const [mdTick, setMdTick] = useState(0)
  const noteRef = useRef<OpenNote | null>(null)
  noteRef.current = note
  const saveNoteRef = useRef<(current: OpenNote) => void>(() => {})

  useEffect(() => {
    onSelectionChange?.(note != null)
  }, [note, onSelectionChange])

  const reapplyMarksAndAnchors = useCallback(() => {
    const root = contentRef.current
    const container = scrollRef.current
    if (!root || !container) return

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

    const next: Record<string, StickyAnchor> = {}
    for (const [id, mark] of Object.entries(marks)) {
      next[id] = anchorBesideMark(mark, container)
    }
    setAnchors(next)

    if (open?.mode === 'edit' && open.commentId) {
      const mark = marks[open.commentId] ?? getMarkByCommentId(root, open.commentId)
      setNoteAnchor(mark ? anchorBesideMark(mark, container) : null)
    } else if (draftMark) {
      setNoteAnchor(anchorBesideMark(draftMark, container))
    } else if (open?.quote) {
      const m = getDraftMark(root)
      setNoteAnchor(m ? anchorBesideMark(m, container) : null)
    } else {
      setNoteAnchor(null)
    }
  }, [comments, planContent])

  useLayoutEffect(() => {
    let cancelled = false
    const run = () => {
      if (!cancelled) reapplyMarksAndAnchors()
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
  }, [reapplyMarksAndAnchors, mdTick, planContent, note?.quote, note?.mode, note?.commentId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScrollOrResize = () => reapplyMarksAndAnchors()
    el.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onScrollOrResize) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      ro?.disconnect()
    }
  }, [reapplyMarksAndAnchors])

  const closeNote = useCallback(() => {
    setNote(null)
    setNoteAnchor(null)
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

  // Click highlight → open note for direct edit
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
    setNoteAnchor(null)
    setMdTick((n) => n + 1)
  }, [comments, idPrefix, onCommentsChange])
  saveNoteRef.current = saveNote

  const removeComment = useCallback((id: string) => {
    onCommentsChange(comments.filter((c) => c.id !== id))
    if (note?.commentId === id) {
      setNote(null)
      setNoteAnchor(null)
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

      // While a sticky is open, keep plan-approval host shortcuts from stealing keys.
      if (e.key === 'Enter') {
        // Plain Enter → newline in the note (do not submit / do not Approve).
        // ⌘/Ctrl+Enter → save note.
        if (isNote && (e.metaKey || e.ctrlKey) && !e.isComposing) {
          e.preventDefault()
          e.stopPropagation()
          saveNote(note)
          return
        }
        if (isNote) {
          e.stopPropagation()
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

  /** Pin size — keep in sync with collapsed pin button. */
  const PIN = 18

  const clampPos = (top: number, left: number, w = PIN, h = PIN) => {
    const box = scrollRef.current
    const maxL = Math.max(0, (box?.clientWidth ?? 400) - w - 4)
    const maxT = Math.max(0, (box?.scrollHeight ?? 400) - h - 4)
    return {
      top: Math.min(Math.max(0, top), maxT),
      left: Math.min(Math.max(0, left), maxL),
    }
  }

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

        {/* Collapsed pin: top-right of the first line of the selection */}
        {comments.map((c, index) => {
          if (note?.commentId === c.id) return null
          const anchor = anchors[c.id]
          if (!anchor) return null
          // anchor is selection top-right; place pin so it sits on that corner
          const pos = clampPos(anchor.top - 2, anchor.left - PIN + 2)
          return (
            <button
              key={c.id}
              type="button"
              data-plan-sticky-ui
              aria-label={t('chat.plan.comments')}
              className={cn(
                'absolute z-20 flex size-[18px] cursor-pointer items-center justify-center',
                'rounded-[1px] bg-[#facc15] text-[9px] font-semibold text-yellow-950/70',
                'shadow-[1px_1px_3px_rgba(0,0,0,0.25)]',
                'hover:brightness-105 dark:bg-yellow-500 dark:text-yellow-950',
              )}
              style={{ top: pos.top, left: pos.left }}
              onClick={() => openExisting(c)}
            >
              {index + 1}
            </button>
          )
        })}

        {/* Open sticky: textarea + top-right X only */}
        {note && (
          <div
            data-plan-sticky-ui
            className="absolute z-30"
            style={(() => {
              const a = noteAnchor
              // Open note hangs from the selection top-right, slightly below the pin
              const pos = clampPos(
                (a?.top ?? 20) + 4,
                (a?.left ?? 20) - 8,
                192,
                100,
              )
              return { top: pos.top, left: pos.left }
            })()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                'relative w-48 rounded-[1px] bg-[#facc15] p-2.5 pt-5',
                'shadow-[2px_3px_0_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.15)]',
                'dark:bg-yellow-500',
              )}
            >
              <button
                type="button"
                className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center text-yellow-950/40 hover:text-yellow-950 dark:text-yellow-950/50"
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
          </div>
        )}
      </div>
    </div>
  )
}
