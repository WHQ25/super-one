import { FileText, Loader2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '../../lib/utils'

export interface ContextAttachmentItem {
  id: string
  title: string
  source?: string
  content?: string
  thumbnail?: string
}

/** Shared attachment presentation for app context, message confirmations and bubbles. */
export function ContextAttachments({ items, onRemove, removing = [], removeLabel = 'Remove attachment', loading, error, className }: {
  items: ContextAttachmentItem[]
  onRemove?: (id: string) => void
  removing?: string[]
  removeLabel?: string
  loading?: boolean
  error?: string
  className?: string
}) {
  if (!items.length && !loading && !error) return null
  return <div className={cn('min-w-0', className)}>
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {items.map(item => <div key={item.id} className="inline-flex max-w-full min-w-0 items-center rounded-md border border-border bg-muted/50 text-xs">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-left" aria-label={item.title}>
              {item.thumbnail ? <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" className="size-5 shrink-0 rounded object-cover" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 truncate">{item.source && <span className="text-muted-foreground">{item.source} · </span>}{item.title}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3" onOpenAutoFocus={event => event.preventDefault()}>
            <p className="break-words text-xs font-medium">{item.title}</p>
            {item.content && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{item.content}</pre>}
          </PopoverContent>
        </Popover>
        {onRemove && <button type="button" disabled={removing.includes(item.id)} aria-label={`${removeLabel}: ${item.title}`} onClick={() => onRemove(item.id)} className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
          {removing.includes(item.id) ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
        </button>}
      </div>)}
      {loading && <Loader2 aria-label="Loading attachments" className="size-4 animate-spin text-muted-foreground" />}
    </div>
    {error && <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p>}
  </div>
}
