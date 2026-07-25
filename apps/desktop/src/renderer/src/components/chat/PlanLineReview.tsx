import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Trash2, X } from 'lucide-react'
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

type DraftState = {
  mode: 'create' | 'edit'
  commentId?: string
  startLine: number
  endLine: number
  quote: string
  text: string
}

/**
 * Sticky-note plan review:
 * - Rendered markdown
 * - Selection wraps real <mark> highlight (in-flow → correct position)
 * - Paper sticky note beside the mark for compose / preview / edit
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
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [anchors, setAnchors] = useState<Record<string, StickyAnchor>>({})
  const [draftAnchor, setDraftAnchor] = useState<StickyAnchor | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [mdTick, setMdTick] = useState(0)

  useEffect(() => {
    onSelectionChange?.(draft != null || expandedId != null)
  }, [draft, expandedId, onSelectionChange])

  const reapplyMarksAndAnchors = useCallback(() => {
    const root = contentRef.current
    const container = scrollRef.current
    if (!root || !container) return

    const items = comments.map((c) => ({
      id: c.id,
      quote: (c.quote?.trim() || quoteFromLines(planContent, c.startLine, c.endLine)),
    }))
    const { marks, draftMark } = applyStickyMarks(
      root,
      items,
      draft && draft.mode === 'create' ? draft.quote : null,
    )

    const next: Record<string, StickyAnchor> = {}
    for (const [id, mark] of Object.entries(marks)) {
      next[id] = anchorBesideMark(mark, container)
    }
    setAnchors(next)

    if (draft?.mode === 'edit' && draft.commentId) {
      const mark = marks[draft.commentId] ?? getMarkByCommentId(root, draft.commentId)
      setDraftAnchor(mark ? anchorBesideMark(mark, container) : null)
    } else if (draftMark) {
      setDraftAnchor(anchorBesideMark(draftMark, container))
    } else if (draft?.quote) {
      // Fallback: still show note near first match attempt after marks
      const m = getDraftMark(root)
      setDraftAnchor(m ? anchorBesideMark(m, container) : null)
    } else {
      setDraftAnchor(null)
    }
  }, [comments, planContent, draft])

  // Re-apply after markdown paints (Streamdown is async-ish).
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
  }, [reapplyMarksAndAnchors, mdTick, planContent])

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

  // Clicking a saved mark expands its sticky.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement | null)?.closest?.(`mark[data-plan-sticky-id]`) as HTMLElement | null
      if (!mark) return
      const id = mark.getAttribute('data-plan-sticky-id')
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      setExpandedId((prev) => (prev === id ? null : id))
      setDraft(null)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [mdTick, planContent])

  const clearDraft = useCallback(() => {
    setDraft(null)
    setDraftAnchor(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const openCreateFromSelection = useCallback(() => {
    const root = contentRef.current
    if (!root) return
    if (draft?.mode === 'edit') return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return
    // Ignore selections that start inside a sticky note control
    if ((anchor as Node).parentElement?.closest?.('[data-plan-sticky-ui]')) return

    const quote = sel.toString().trim()
    if (!quote || quote.length < 2) return

    // Prefer line mapping; if soft-map fails (rare), still allow sticky using L1–L1 fallback
    // so the UX never silently drops a valid selection.
    const lineRange =
      selectionTextToLineRange(planContent, quote)
      ?? { startLine: 1, endLine: 1 }

    // Same quote already drafting — don't reset the note.
    if (draft?.mode === 'create' && draft.quote === quote) return

    setExpandedId(null)
    setDraft({
      mode: 'create',
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      quote,
      text: draft?.mode === 'create' ? draft.text : '',
    })
    sel.removeAllRanges()
    requestAnimationFrame(() => {
      setMdTick((n) => n + 1)
      inputRef.current?.focus()
    })
  }, [draft, planContent])

  // Document-level capture: React synthetic onMouseUp is unreliable for some
  // automation/CDP paths, and users select across nested markdown nodes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => openCreateFromSelection(), 0)
    }
    const onUp = (e: MouseEvent) => {
      const root = contentRef.current
      if (!root) return
      if (e.target instanceof Node && (e.target as HTMLElement).closest?.('[data-plan-sticky-ui]')) return
      schedule()
    }
    document.addEventListener('mouseup', onUp, true)
    return () => {
      document.removeEventListener('mouseup', onUp, true)
      if (timer) clearTimeout(timer)
    }
  }, [openCreateFromSelection])

  const commitDraft = useCallback(() => {
    if (!draft) return
    const text = draft.text.trim()
    if (!text) return
    if (draft.mode === 'edit' && draft.commentId) {
      onCommentsChange(
        comments.map((c) =>
          c.id === draft.commentId ? { ...c, text, quote: draft.quote || c.quote } : c,
        ),
      )
    } else {
      const id = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      onCommentsChange([
        ...comments,
        {
          id,
          startLine: draft.startLine,
          endLine: draft.endLine,
          text,
          quote: draft.quote,
        },
      ])
    }
    clearDraft()
    setExpandedId(null)
    setMdTick((n) => n + 1)
  }, [draft, comments, idPrefix, onCommentsChange, clearDraft])

  const removeComment = useCallback((id: string) => {
    onCommentsChange(comments.filter((c) => c.id !== id))
    setExpandedId(null)
    if (draft?.commentId === id) clearDraft()
    setMdTick((n) => n + 1)
  }, [comments, onCommentsChange, draft?.commentId, clearDraft])

  const beginEdit = useCallback((c: PlanLineComment) => {
    setExpandedId(null)
    setDraft({
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
      inputRef.current?.select()
    })
  }, [planContent])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement
      const isDraft =
        active instanceof HTMLTextAreaElement && active.dataset.planDraft !== undefined

      if (e.key === 'Escape' && (isDraft || draft || expandedId)) {
        e.preventDefault()
        e.stopPropagation()
        clearDraft()
        setExpandedId(null)
        return
      }
      if (isDraft && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        commitDraft()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [clearDraft, commitDraft, draft, expandedId])

  // Clamp note left so it stays in view
  const clampNoteLeft = (left: number, noteWidth = 200) => {
    const w = scrollRef.current?.clientWidth ?? 400
    return Math.min(Math.max(8, left), Math.max(8, w - noteWidth - 12))
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
          <div
            ref={contentRef}
            className="select-text px-4 py-3 pr-28"
            onLoadCapture={() => setMdTick((n) => n + 1)}
          >
            <CopyableMarkdown text={planContent} isStreaming={false} />
          </div>
        )}

        {/* Collapsed sticky tabs on saved highlights */}
        {comments.map((c, index) => {
          if (draft?.commentId === c.id) return null
          const anchor = anchors[c.id]
          if (!anchor) return null
          const open = expandedId === c.id
          return (
            <div
              key={c.id}
              data-plan-sticky-ui
              className="absolute z-20"
              style={{
                top: anchor.top,
                left: clampNoteLeft(anchor.left, open ? 208 : 28),
              }}
              onMouseEnter={() => !open && setExpandedId(c.id)}
            >
              {!open ? (
                <button
                  type="button"
                  title={c.text}
                  className={cn(
                    'group relative size-7 cursor-pointer rounded-[3px] border border-amber-400/50',
                    'bg-[#fff59d] shadow-[1px_2px_4px_rgba(0,0,0,0.18)]',
                    'rotate-2 transition hover:rotate-0 hover:scale-105 dark:border-amber-500/40 dark:bg-amber-700/90',
                  )}
                  onClick={() => setExpandedId(c.id)}
                >
                  {/* folded corner */}
                  <span className="pointer-events-none absolute right-0 top-0 size-0 border-l-[8px] border-t-[8px] border-l-transparent border-t-amber-200/90 dark:border-t-amber-500/50" />
                  <span className="text-[10px] font-semibold text-amber-900/70 dark:text-amber-100">
                    {index + 1}
                  </span>
                </button>
              ) : (
                <StickyNoteCard
                  className="-rotate-1"
                  onMouseLeave={() => {
                    // keep open until click outside — leave only if not interacting
                  }}
                >
                  <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-amber-950 dark:text-amber-50">
                    {c.text}
                  </p>
                  <div className="mt-2 flex items-center justify-end gap-0.5 border-t border-amber-900/10 pt-1.5 dark:border-amber-100/15">
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-900/70 hover:bg-amber-900/10 dark:text-amber-100/80"
                      onClick={() => beginEdit(c)}
                    >
                      <Pencil className="size-3" />
                      {t('chat.plan.editComment')}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-amber-900/70 hover:bg-red-500/15 hover:text-red-700 dark:text-amber-100/80"
                      onClick={() => removeComment(c.id)}
                    >
                      <Trash2 className="size-3" />
                      {t('chat.plan.removeComment')}
                    </button>
                    <button
                      type="button"
                      className="ml-auto rounded p-0.5 text-amber-900/50 hover:bg-amber-900/10 dark:text-amber-100/60"
                      aria-label={t('chat.plan.cancelComment')}
                      onClick={() => setExpandedId(null)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </StickyNoteCard>
              )}
            </div>
          )
        })}

        {/* Compose / edit sticky note — always show when drafting, even if mark wrap lags */}
        {draft && (
          <div
            data-plan-sticky-ui
            className="absolute z-30"
            style={{
              top: draftAnchor?.top ?? 24,
              left: clampNoteLeft(draftAnchor?.left ?? 24, 220),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <StickyNoteCard className="rotate-1 shadow-lg">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-900/45 dark:text-amber-100/40">
                {draft.mode === 'edit' ? t('chat.plan.editComment') : t('chat.plan.addComment')}
              </div>
              <textarea
                ref={inputRef}
                data-plan-draft
                rows={3}
                value={draft.text}
                onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
                placeholder={t('chat.plan.commentPlaceholder')}
                className="w-full resize-none bg-transparent text-[12px] leading-snug text-amber-950 placeholder:text-amber-900/35 focus:outline-none dark:text-amber-50 dark:placeholder:text-amber-100/35"
              />
              <div className="mt-1.5 flex items-center justify-end gap-1 border-t border-amber-900/10 pt-1.5 dark:border-amber-100/15">
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded text-amber-900/50 hover:bg-amber-900/10 dark:text-amber-100/60"
                  aria-label={t('chat.plan.cancelComment')}
                  onClick={() => {
                    clearDraft()
                    setMdTick((n) => n + 1)
                  }}
                >
                  <X className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!draft.text.trim()}
                  className="flex size-6 items-center justify-center rounded text-amber-900 hover:bg-amber-900/10 disabled:opacity-35 dark:text-amber-50"
                  aria-label={t('chat.plan.saveComment')}
                  onClick={commitDraft}
                >
                  <Check className="size-3.5" />
                </button>
              </div>
            </StickyNoteCard>
          </div>
        )}
      </div>
    </div>
  )
}

function StickyNoteCard({
  children,
  className,
  onMouseLeave,
}: {
  children: ReactNode
  className?: string
  onMouseLeave?: () => void
}) {
  return (
    <div
      onMouseLeave={onMouseLeave}
      className={cn(
        'relative w-52 rounded-sm border border-amber-300/70 bg-[#fff59d] p-2.5',
        'shadow-[2px_4px_10px_rgba(0,0,0,0.16),0_1px_0_rgba(255,255,255,0.5)_inset]',
        'dark:border-amber-600/40 dark:bg-amber-800/95',
        // top tape
        'before:absolute before:left-1/2 before:top-0 before:h-2 before:w-10 before:-translate-x-1/2 before:-translate-y-1/2',
        'before:rounded-[1px] before:bg-amber-200/80 before:shadow-sm dark:before:bg-amber-600/50',
        // folded corner
        'after:pointer-events-none after:absolute after:right-0 after:top-0 after:size-0',
        'after:border-l-[14px] after:border-t-[14px] after:border-l-transparent after:border-t-amber-50/90',
        'dark:after:border-t-amber-700/80',
        className,
      )}
    >
      {children}
    </div>
  )
}
