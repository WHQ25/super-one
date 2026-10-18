import { useRef, useState } from 'react'
import { StickyNote, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { ReplyComment } from '@/stores/chat'
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
 * The comments on agent replies the next turn sends, as one chip: a lone
 * comment opens its note directly; several list in a popover, numbered and
 * colored like their pins.
 */
export function ReplyCommentChips({ comments, onOpen, onRemove, onClear }: ReplyCommentChipsProps) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const [open, setOpen] = useState(false)
  // A picked comment's note takes focus; handing it back to the chip would blur (and close) the note.
  const picked = useRef(false)
  if (comments.length === 0) return null

  const isMulti = comments.length > 1
  const first = comments[0]
  const count = t('chat.replyComments.count', { count: comments.length })

  const chip = (
    <button
      type="button"
      title={isMulti ? undefined : first.quote}
      onClick={() => (isMulti ? setOpen((o) => !o) : onOpen(first.id))}
      className="group inline-flex max-w-72 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm whitespace-nowrap text-foreground/85 transition-colors hover:bg-background/70 hover:text-foreground"
    >
      {isMulti
        ? <StickyNote className="size-3 shrink-0 text-primary/60 transition-colors group-hover:text-primary/80" />
        : <StickyPinFace swatch={stickyForIndex(0)} isDark={isDark} index={0} size={14} />}
      <span className="truncate">{isMulti ? count : first.text}</span>
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
  )

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {!isMulti ? chip : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{chip}</PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-80 max-w-[calc(100vw-2rem)] p-3"
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
                <div key={c.id} className="group/comment relative">
                  <button
                    type="button"
                    onClick={() => { picked.current = true; setOpen(false); onOpen(c.id) }}
                    className="flex w-full items-start gap-2 rounded-md bg-muted p-2 pr-7 text-left transition-colors hover:bg-accent"
                  >
                    <StickyPinFace swatch={stickyForIndex(index)} isDark={isDark} index={index} size={14} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-relaxed text-foreground/90">{c.text}</span>
                      <span className="mt-0.5 line-clamp-2 border-l-2 border-border pl-1.5 text-[11px] leading-snug text-muted-foreground">{c.quote}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('chat.plan.removeComment')}
                    onClick={() => onRemove(c.id)}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/comment:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
