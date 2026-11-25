import { useMemo, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessageReplyComment } from '@superone/shared/agent-types'
import { expandLineRanges, parseFilePrefix, type ParsedFilePrefix } from '@superone/shared/file-quote-prefix'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { useUserBubblePorts } from './user-bubble-ports'

function basenameOf(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

function ReplyCommentItem({ comment, index }: { comment: ChatMessageReplyComment; index: number }) {
  const { QuoteBody } = useUserBubblePorts()
  const parsed = useMemo<ParsedFilePrefix | null>(() => parseFilePrefix(comment.quote), [comment.quote])
  const lineNums = useMemo(
    () => (parsed ? expandLineRanges(parsed.rangeText) : []),
    [parsed],
  )

  return (
    <div className="rounded-md bg-muted p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
          {comment.text}
        </span>
      </div>
      {parsed ? (
        <div className="mt-2 rounded-md bg-background/70 p-2">
          <div className="mb-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <FileIcon name={basenameOf(parsed.filePath)} size={11} className="shrink-0" />
            <span className="shrink-0 whitespace-nowrap font-medium">{basenameOf(parsed.filePath)}</span>
            <span className="min-w-0 truncate font-mono text-muted-foreground/70">{parsed.rangeText}</span>
          </div>
          <QuoteBody quote={parsed} lineNums={lineNums} />
        </div>
      ) : (
        <blockquote className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-2 text-xs leading-relaxed text-muted-foreground">
          {comment.quote}
        </blockquote>
      )}
    </div>
  )
}

export function UserReplyCommentChip({ comments }: { comments: ChatMessageReplyComment[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (comments.length === 0) return null

  const count = t('chat.replyComments.count', { count: comments.length })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-sm text-foreground/85 whitespace-nowrap select-none cursor-pointer transition-colors hover:bg-background/70 hover:text-foreground"
        >
          <StickyNote className="size-3 shrink-0 text-primary/60 transition-colors group-hover:text-primary/80" />
          <span className="max-w-55 truncate">{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[30rem] max-w-[calc(100vw-2rem)] p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <StickyNote className="size-3 text-primary/60" />
          <span>{count}</span>
        </div>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {comments.map((comment, index) => (
            <ReplyCommentItem key={index} comment={comment} index={index} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
