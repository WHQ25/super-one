import { useRef, useState } from 'react'
import { StickyNote, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { openCodeCommentEdit } from './code-comment-note'
import { CommentQuote } from './comment-quote'
import { useSessionScope, type ReplyComment } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { stickyForIndex } from './plan-sticky-palette'
import { StickyPinFace } from './plan-sticky-visuals'

interface ReplyCommentChipsProps {
  comments: ReplyComment[]
  /** Open the comment's note on its highlight in the transcript. */
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}

/**
 * The comments the next turn sends, as one chip. One comment uses the same
 * list as several: a count opens the cards, numbered and colored like their pins.
 */
export function ReplyCommentChips({ comments, onOpen, onRemove, onClear }: ReplyCommentChipsProps) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const scope = useSessionScope()
  const [open, setOpen] = useState(false)
  // A picked comment's note takes focus; handing it back to the chip would blur (and close) the note.
  const picked = useRef(false)
  if (comments.length === 0) return null

  const count = t('chat.replyComments.count', { count: comments.length })

  const openComment = (comment: ReplyComment, el: HTMLElement) => {
    if (comment.surface !== 'code') {
      onOpen(comment.id)
      return
    }
    const rect = el.getBoundingClientRect()
    openCodeCommentEdit(comment, rect.left, rect.top, scope ?? undefined)
  }

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group inline-flex max-w-72 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm whitespace-nowrap text-foreground/85 transition-colors hover:bg-background/70 hover:text-foreground"
          >
            <StickyNote className="size-3 shrink-0 text-primary/60 transition-colors group-hover:text-primary/80" />
            <span className="truncate">{count}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={t('chat.plan.removeComment')}
              onClick={(e) => { e.stopPropagation(); onClear() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClear() }
              }}
              className="ml-0.5 cursor-pointer text-muted-foreground/70 hover:text-foreground"
            >
              <X className="size-3" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-[28rem] max-w-[calc(100vw-2rem)] p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            if (!picked.current) return
            picked.current = false
            e.preventDefault()
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <StickyNote className="size-3 text-primary/60" />
            <span>{count}</span>
          </div>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {comments.map((c, index) => (
              <div key={c.id} className="group/comment rounded-md bg-muted">
                <div className="flex items-start gap-2 px-2 pt-2">
                  <button
                    type="button"
                    onClick={(event) => { picked.current = true; setOpen(false); openComment(c, event.currentTarget) }}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left transition-colors hover:bg-accent"
                  >
                    <StickyPinFace swatch={stickyForIndex(index)} isDark={isDark} index={index} size={14} />
                    <span className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90">{c.text}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.plan.removeComment')}
                    onClick={() => onRemove(c.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/comment:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={(event) => { picked.current = true; setOpen(false); openComment(c, event.currentTarget) }}
                  className="block w-full px-2 pb-2 pt-1 text-left"
                >
                  <CommentQuote quote={c.quote} />
                </button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
