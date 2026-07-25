import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import {
  selectionTextToLineRange,
  type PlanLineComment,
} from './plan-feedback'
import {
  layoutForQuote,
  quoteFromLines,
  rangeToLayout,
  type AnnotationLayout,
  type RectBox,
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
  layout: AnnotationLayout
}

/**
 * Sticky-note plan review: rendered markdown, select text → highlight + mini
 * editor beside it; saved comments become a corner icon (hover preview, click edit/delete).
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [layouts, setLayouts] = useState<Record<string, AnnotationLayout>>({})
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    onSelectionChange?.(draft != null || openId != null)
  }, [draft, openId, onSelectionChange])

  const recomputeLayouts = useCallback(() => {
    const root = contentRef.current
    const container = scrollRef.current
    if (!root || !container) {
      setLayouts({})
      return
    }
    const next: Record<string, AnnotationLayout> = {}
    for (const c of comments) {
      const quote = c.quote?.trim() || quoteFromLines(planContent, c.startLine, c.endLine)
      if (!quote) continue
      const layout = layoutForQuote(root, container, quote)
      if (layout) next[c.id] = layout
    }
    setLayouts(next)
  }, [comments, planContent])

  useLayoutEffect(() => {
    // Wait a frame for Streamdown to paint.
    const id = requestAnimationFrame(() => recomputeLayouts())
    return () => cancelAnimationFrame(id)
  }, [recomputeLayouts, planContent])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => recomputeLayouts()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => recomputeLayouts()) : null
    ro?.observe(el)
    window.addEventListener('resize', recomputeLayouts)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      window.removeEventListener('resize', recomputeLayouts)
    }
  }, [recomputeLayouts])

  const clearDraft = useCallback(() => {
    setDraft(null)
    const sel = window.getSelection()
    sel?.removeAllRanges()
  }, [])

  const openCreateFromSelection = useCallback(() => {
    const root = contentRef.current
    const container = scrollRef.current
    if (!root || !container) return
    if (draft?.mode === 'edit') return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return

    const quote = sel.toString().trim()
    if (!quote) return
    const lineRange = selectionTextToLineRange(planContent, quote)
    if (!lineRange) return

    const domRange = sel.getRangeAt(0).cloneRange()
    const layout = rangeToLayout(domRange, container)
    if (!layout) return

    setOpenId(null)
    setDraft({
      mode: 'create',
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      quote,
      text: '',
      layout,
    })
    // Keep visual via our highlight overlays; clear native selection.
    sel.removeAllRanges()
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [draft?.mode, planContent])

  const onMouseUp = useCallback(() => {
    requestAnimationFrame(() => openCreateFromSelection())
  }, [openCreateFromSelection])

  const commitDraft = useCallback(() => {
    if (!draft) return
    const text = draft.text.trim()
    if (!text) return
    if (draft.mode === 'edit' && draft.commentId) {
      onCommentsChange(
        comments.map((c) => (c.id === draft.commentId ? { ...c, text, quote: draft.quote || c.quote } : c)),
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
    setOpenId(null)
  }, [draft, comments, idPrefix, onCommentsChange, clearDraft])

  const removeComment = useCallback((id: string) => {
    onCommentsChange(comments.filter((c) => c.id !== id))
    setOpenId(null)
    setHoverId(null)
    if (draft?.commentId === id) clearDraft()
  }, [comments, onCommentsChange, draft?.commentId, clearDraft])

  const beginEdit = useCallback((c: PlanLineComment) => {
    const root = contentRef.current
    const container = scrollRef.current
    if (!root || !container) return
    const quote = c.quote?.trim() || quoteFromLines(planContent, c.startLine, c.endLine)
    const layout =
      layouts[c.id]
      ?? (quote ? layoutForQuote(root, container, quote) : null)
    if (!layout) return
    setOpenId(null)
    setDraft({
      mode: 'edit',
      commentId: c.id,
      startLine: c.startLine,
      endLine: c.endLine,
      quote,
      text: c.text,
      layout,
    })
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [layouts, planContent])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement
      const isDraftInput =
        active instanceof HTMLInputElement && active.dataset.planDraft !== undefined

      if (e.key === 'Escape' && (isDraftInput || draft || openId)) {
        e.preventDefault()
        e.stopPropagation()
        clearDraft()
        setOpenId(null)
        return
      }
      if (isDraftInput && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        commitDraft()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [clearDraft, commitDraft, draft, openId])

  const draftHighlightRects: RectBox[] = draft?.layout.rects ?? []
  const editorPos = draft?.layout.editor

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        onMouseUp={onMouseUp}
      >
        {planContent.trim().length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t('chat.plan.emptyPlan')}</div>
        ) : (
          <div ref={contentRef} className="select-text px-4 py-3">
            <CopyableMarkdown text={planContent} isStreaming={false} />
          </div>
        )}

        {/* Saved + draft highlight strips */}
        {comments.map((c) => {
          const layout = layouts[c.id]
          if (!layout) return null
          const active = hoverId === c.id || openId === c.id || draft?.commentId === c.id
          return (
            <div key={`hl-${c.id}`} className="pointer-events-none absolute inset-0 z-[1]">
              {layout.rects.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    'absolute rounded-sm transition-colors',
                    active ? 'bg-amber-400/35 dark:bg-amber-300/25' : 'bg-amber-300/25 dark:bg-amber-400/15',
                  )}
                  style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
                />
              ))}
            </div>
          )
        })}

        {draft && (
          <div className="pointer-events-none absolute inset-0 z-[2]">
            {draftHighlightRects.map((r, i) => (
              <div
                key={i}
                className="absolute rounded-sm bg-sky-400/30 ring-1 ring-sky-500/40 dark:bg-sky-400/20"
                style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
              />
            ))}
          </div>
        )}

        {/* Corner icons for saved comments */}
        {comments.map((c) => {
          const layout = layouts[c.id]
          if (!layout || draft?.commentId === c.id) return null
          const open = openId === c.id
          return (
            <div
              key={`mk-${c.id}`}
              className="absolute z-[3]"
              style={{ top: layout.marker.top, left: layout.marker.left }}
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => setHoverId((id) => (id === c.id ? null : id))}
            >
              <button
                type="button"
                className={cn(
                  'flex size-5 -translate-y-1 translate-x-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-50 text-amber-700 shadow-sm transition',
                  'hover:scale-110 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900',
                  open && 'ring-2 ring-amber-500/50',
                )}
                aria-label={t('chat.plan.comments')}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenId((id) => (id === c.id ? null : c.id))
                }}
              >
                <MessageSquare className="size-3 fill-current" />
              </button>

              {(hoverId === c.id || open) && (
                <div
                  className={cn(
                    'absolute left-0 top-6 z-20 w-56 rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg',
                    'animate-in fade-in-0 zoom-in-95',
                  )}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <p className="max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground">
                    {c.text}
                  </p>
                  {open && (
                    <div className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => beginEdit(c)}
                      >
                        <Pencil className="size-3" />
                        {t('chat.plan.editComment')}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeComment(c.id)}
                      >
                        <Trash2 className="size-3" />
                        {t('chat.plan.removeComment')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Minimal sticky editor next to selection */}
        {draft && editorPos && (
          <div
            className="absolute z-30 flex w-[min(280px,calc(100%-24px))] items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{
              top: editorPos.top,
              left: Math.min(editorPos.left, (scrollRef.current?.clientWidth ?? 320) - 200),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              data-plan-draft
              type="text"
              value={draft.text}
              onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
              placeholder={t('chat.plan.commentPlaceholder')}
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              disabled={!draft.text.trim()}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-success hover:bg-success/10 disabled:opacity-40"
              aria-label={t('chat.plan.saveComment')}
              onClick={commitDraft}
            >
              <Check className="size-3.5" />
            </button>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('chat.plan.cancelComment')}
              onClick={() => {
                clearDraft()
                setOpenId(null)
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
