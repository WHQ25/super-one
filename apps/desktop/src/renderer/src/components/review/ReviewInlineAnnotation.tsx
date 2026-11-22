import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { ReplyComment } from '@/stores/chat'
import type { ReviewDraftAnnotation } from './review-diff-utils'

interface ReviewCommentCardProps {
  comment: ReplyComment
  onUpdate: (id: string, text: string) => void
  onRemove: (id: string) => void
}

export function ReviewCommentCard({ comment, onUpdate, onRemove }: ReviewCommentCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.text)

  const handleSave = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onUpdate(comment.id, trimmed)
    setEditing(false)
  }

  return (
    <div
      data-testid="review-inline-comment"
      className="my-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-sm"
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                handleSave()
              } else if (e.key === 'Escape') {
                setEditing(false)
                setDraft(comment.text)
              }
            }}
            rows={2}
            autoFocus
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setDraft(comment.text)
              }}
            >
              <X className="size-3" />
              {t('review.actions.cancel')}
            </Button>
            <Button size="xs" onClick={handleSave} disabled={!draft.trim()}>
              <Check className="size-3" />
              {t('review.actions.saveComment')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <p className="whitespace-pre-wrap break-words leading-relaxed">{comment.text}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('review.actions.edit')}
              onClick={() => {
                setDraft(comment.text)
                setEditing(true)
              }}
            >
              <Pencil />
            </IconButton>
            <IconButton
              size="xs"
              variant="destructive"
              tooltip={t('review.actions.delete')}
              onClick={() => onRemove(comment.id)}
            >
              <Trash2 />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  )
}

interface ReviewDraftCardProps {
  draft: ReviewDraftAnnotation
  onSubmit: (text: string) => void
  onCancel: () => void
}

export function ReviewDraftCard({ draft, onSubmit, onCancel }: ReviewDraftCardProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const rangeLabel = draft.startLine === draft.endLine
    ? `L${draft.startLine}`
    : `L${draft.startLine}-L${draft.endLine}`

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }

  return (
    <div
      data-testid="review-inline-draft"
      className="my-1.5 rounded-lg border border-primary/40 bg-card p-2.5 text-xs text-card-foreground shadow-sm"
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-mono">{rangeLabel}</span>
        <span>{t('review.actions.addComment')}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
        rows={2}
        autoFocus
        placeholder={t('review.actions.commentPlaceholder')}
        className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          {t('review.actions.cancel')}
        </Button>
        <Button size="xs" onClick={handleSubmit} disabled={!text.trim()}>
          {t('review.actions.saveComment')}
        </Button>
      </div>
    </div>
  )
}
