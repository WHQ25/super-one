import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { MessageSquarePlus, Trash2 } from 'lucide-react'
import {
  normalizeLineRange,
  splitPlanLines,
  type PlanLineComment,
} from './plan-feedback'

export interface PlanLineReviewProps {
  planContent: string
  comments: PlanLineComment[]
  onCommentsChange: (next: PlanLineComment[]) => void
  /** Called when Escape should clear selection (parent may also handle reject). */
  onSelectionChange?: (hasSelection: boolean) => void
  idPrefix: string
}

/**
 * Line-numbered plan body with range selection and per-range comments.
 * Parent owns the freeform overall feedback + approve/reject actions.
 */
export function PlanLineReview({
  planContent,
  comments,
  onCommentsChange,
  onSelectionChange,
  idPrefix,
}: PlanLineReviewProps) {
  const { t } = useTranslation()
  const lines = useMemo(() => splitPlanLines(planContent), [planContent])
  const [selAnchor, setSelAnchor] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [draftComment, setDraftComment] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [isDraftFocused, setIsDraftFocused] = useState(false)

  const selection = useMemo(() => {
    if (selAnchor == null || selEnd == null) return null
    return normalizeLineRange(selAnchor, selEnd)
  }, [selAnchor, selEnd])

  useEffect(() => {
    onSelectionChange?.(selection != null || draftOpen)
  }, [selection, draftOpen, onSelectionChange])

  useEffect(() => {
    if (!dragging) return
    const up = () => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [dragging])

  const clearSelection = useCallback(() => {
    setSelAnchor(null)
    setSelEnd(null)
    setDraftOpen(false)
    setDraftComment('')
  }, [])

  const openDraftForSelection = useCallback(() => {
    if (!selection) return
    setDraftOpen(true)
    setDraftComment('')
  }, [selection])

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

  const onLineMouseDown = useCallback((lineNo: number, e: MouseEvent) => {
    e.preventDefault()
    if (e.shiftKey && selAnchor != null) {
      setSelEnd(lineNo)
      setDragging(false)
      return
    }
    setSelAnchor(lineNo)
    setSelEnd(lineNo)
    setDragging(true)
    setDraftOpen(false)
    setDraftComment('')
  }, [selAnchor])

  const onLineMouseEnter = useCallback((lineNo: number) => {
    if (!dragging || selAnchor == null) return
    setSelEnd(lineNo)
  }, [dragging, selAnchor])

  const isLineSelected = useCallback((lineNo: number) => {
    if (!selection) return false
    return lineNo >= selection.startLine && lineNo <= selection.endLine
  }, [selection])

  // Local keys: C to comment, Enter in draft to save, Escape clears draft/selection.
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
        return
      }

      if (e.key === 'c' && selection && !(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        openDraftForSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [clearSelection, commitDraftComment, draftOpen, openDraftForSelection, selection])

  const selLabel = selection
    ? selection.startLine === selection.endLine
      ? `L${selection.startLine}`
      : `L${selection.startLine}–${selection.endLine}`
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {lines.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{t('chat.plan.emptyPlan')}</div>
        ) : (
          <div className="select-none py-2 font-mono text-[12px] leading-5">
            {lines.map((line, idx) => {
              const lineNo = idx + 1
              const selected = isLineSelected(lineNo)
              return (
                <div
                  key={lineNo}
                  role="button"
                  tabIndex={-1}
                  data-plan-line={lineNo}
                  className={`flex cursor-pointer gap-0 px-2 ${
                    selected
                      ? 'bg-primary/15 text-foreground'
                      : 'text-foreground/90 hover:bg-muted/60'
                  }`}
                  onMouseDown={(e) => onLineMouseDown(lineNo, e)}
                  onMouseEnter={() => onLineMouseEnter(lineNo)}
                  onDoubleClick={() => {
                    setSelAnchor(lineNo)
                    setSelEnd(lineNo)
                    setDraftOpen(true)
                    setDraftComment('')
                  }}
                >
                  <span className={`w-10 shrink-0 select-none pr-2 text-right tabular-nums ${
                    selected ? 'text-primary' : 'text-muted-foreground/60'
                  }`}>
                    {lineNo}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                    {line.length === 0 ? ' ' : line}
                  </span>
                </div>
              )
            })}
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
            {!draftOpen && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto h-6 cursor-pointer px-2 text-[11px]"
                onClick={openDraftForSelection}
              >
                {t('chat.plan.addComment')}
                <Kbd variant="inline" className="ml-1">c</Kbd>
              </Button>
            )}
          </div>
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
