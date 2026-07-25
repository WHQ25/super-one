import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import {
  selectionTextToLineRange,
  type PlanLineComment,
} from './plan-feedback'
import { CopyableMarkdown } from './CopyableMarkdown'

export interface PlanLineReviewProps {
  planContent: string
  comments: PlanLineComment[]
  onCommentsChange: (next: PlanLineComment[]) => void
  /** Called when Escape should clear selection (parent may also handle reject). */
  onSelectionChange?: (hasSelection: boolean) => void
  idPrefix: string
}

/**
 * Rendered markdown plan body. Users select text (划词) to attach line comments;
 * no line-gutter drag, double-click, or "c" shortcut.
 */
export function PlanLineReview({
  planContent,
  comments,
  onCommentsChange,
  onSelectionChange,
  idPrefix,
}: PlanLineReviewProps) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{ startLine: number; endLine: number; quote: string } | null>(null)
  const [draftComment, setDraftComment] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [isDraftFocused, setIsDraftFocused] = useState(false)
  useEffect(() => {
    onSelectionChange?.(selection != null || draftOpen)
  }, [selection, draftOpen, onSelectionChange])

  const clearSelection = useCallback(() => {
    setSelection(null)
    setDraftOpen(false)
    setDraftComment('')
    const sel = window.getSelection()
    if (sel && bodyRef.current && sel.anchorNode && bodyRef.current.contains(sel.anchorNode)) {
      sel.removeAllRanges()
    }
  }, [])

  const openDraftFromDomSelection = useCallback(() => {
    const root = bodyRef.current
    if (!root) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const anchor = sel.anchorNode
    const focus = sel.focusNode
    if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return

    const quote = sel.toString()
    if (!quote.trim()) return
    const range = selectionTextToLineRange(planContent, quote)
    if (!range) return

    setSelection({ ...range, quote: quote.trim() })
    setDraftOpen(true)
    setDraftComment('')
  }, [planContent])

  const onMouseUp = useCallback(() => {
    // Defer so the browser finishes updating the selection.
    requestAnimationFrame(() => openDraftFromDomSelection())
  }, [openDraftFromDomSelection])

  const commitDraftComment = useCallback(() => {
    if (!selection) return
    const text = draftComment.trim()
    if (!text) return
    const id = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    onCommentsChange([
      ...comments,
      {
        id,
        startLine: selection.startLine,
        endLine: selection.endLine,
        text,
      },
    ])
    clearSelection()
  }, [selection, draftComment, idPrefix, comments, onCommentsChange, clearSelection])

  const removeComment = useCallback((id: string) => {
    onCommentsChange(comments.filter((c) => c.id !== id))
  }, [comments, onCommentsChange])

  // Escape clears draft/selection; Enter in draft saves. No "c" shortcut.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement
      const isDraftInput =
        active instanceof HTMLInputElement && active.dataset.planDraft !== undefined

      if (e.key === 'Escape' && (isDraftInput || draftOpen || selection)) {
        e.preventDefault()
        e.stopPropagation()
        clearSelection()
        return
      }

      if (isDraftInput && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        commitDraftComment()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [clearSelection, commitDraftComment, draftOpen, selection])

  const selLabel = useMemo(() => {
    if (!selection) return null
    return selection.startLine === selection.endLine
      ? `L${selection.startLine}`
      : `L${selection.startLine}–${selection.endLine}`
  }, [selection])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={bodyRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        onMouseUp={onMouseUp}
      >
        {planContent.trim().length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t('chat.plan.emptyPlan')}</div>
        ) : (
          <div className="select-text px-4 py-3">
            <CopyableMarkdown text={planContent} isStreaming={false} />
          </div>
        )}

        {comments.length > 0 && (
          <div className="space-y-1.5 border-t border-border px-4 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('chat.plan.comments')}
            </div>
            {comments.map((c) => {
              const range =
                c.startLine === c.endLine
                  ? `L${c.startLine}`
                  : `L${c.startLine}–${c.endLine}`
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                    {range}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap text-foreground">{c.text}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('chat.plan.removeComment')}
                    onClick={() => removeComment(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {(selection || draftOpen) && (
        <div className="shrink-0 space-y-1.5 border-t border-border bg-muted/30 px-4 py-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <MessageSquarePlus className="size-3.5 text-primary" />
            <span>{t('chat.plan.commentOn', { range: selLabel ?? '…' })}</span>
          </div>
          {selection?.quote ? (
            <div className="line-clamp-2 rounded border border-border/60 bg-background/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {selection.quote}
            </div>
          ) : null}
          {draftOpen && (
            <div className="flex items-center gap-2">
              <input
                data-plan-draft
                type="text"
                autoFocus
                value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)}
                onFocus={() => setIsDraftFocused(true)}
                onBlur={() => setIsDraftFocused(false)}
                placeholder={t('chat.plan.commentPlaceholder')}
                className="h-7 min-w-0 flex-1 rounded bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                className="h-7 cursor-pointer px-2 text-xs"
                disabled={!draftComment.trim()}
                onClick={commitDraftComment}
              >
                {t('chat.plan.saveComment')}
                {isDraftFocused && <Kbd variant="inline" className="ml-1">↵</Kbd>}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 cursor-pointer px-2 text-xs"
                onClick={clearSelection}
              >
                {t('chat.plan.cancelComment')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
