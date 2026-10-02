import { AppWindow, Loader2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '../../lib/utils'

export interface ContextAttachmentItem {
  id: string
  title: string
  source?: string
  /** The source's own icon; `thumbnail` previews the attached content itself. */
  icon?: string
  content?: string
  thumbnail?: string
  previewImages?: Array<{ src: string; alt: string }>
}

/**
 * Shared attachment presentation for app context, message confirmations and bubbles.
 * Compact single-line chips in the mini-app context style: icon, source, a muted
 * summary and a small remove action; the full content opens in a popover.
 */
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
      {items.map(item => <span key={item.id} data-context-attachment className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap select-none">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="flex min-w-0 cursor-pointer items-center gap-1 text-left" aria-label={item.title}>
              {item.icon
                ? <img src={item.icon} alt="" referrerPolicy="no-referrer" className="size-3 shrink-0 rounded-sm object-contain" />
                : !item.thumbnail && <AppWindow className="size-3 shrink-0 text-muted-foreground" />}
              {item.thumbnail && <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" className="size-4 shrink-0 rounded-sm object-cover" />}
              {item.source && <>
                <span className="max-w-35 shrink-0 truncate font-medium text-foreground">{item.source}</span>
                <span className="text-[10px] text-muted-foreground">·</span>
              </>}
              <span className="min-w-0 max-w-60 truncate text-[11px] text-muted-foreground">{item.title}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3" onOpenAutoFocus={event => event.preventDefault()}>
            <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
              {item.source && <span className="shrink-0">{item.source}</span>}
              <span className="min-w-0 break-words text-muted-foreground">{item.source ? `· ${item.title}` : item.title}</span>
            </div>
            {item.previewImages?.map((preview, index) => <img key={index} src={preview.src} alt={preview.alt} referrerPolicy="no-referrer" className="mb-2 max-h-40 w-full rounded object-contain" />)}
            {item.content && <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">{item.content}</pre>}
          </PopoverContent>
        </Popover>
        {onRemove && <button type="button" disabled={removing.includes(item.id)} aria-label={`${removeLabel}: ${item.title}`} onClick={() => onRemove(item.id)} className="ml-0.5 shrink-0 cursor-pointer text-muted-foreground/70 hover:text-foreground disabled:opacity-50">
          {removing.includes(item.id) ? <Loader2 className="size-2.5 animate-spin" /> : <X className="size-2.5" />}
        </button>}
      </span>)}
      {loading && <Loader2 aria-label="Loading attachments" className="size-4 animate-spin text-muted-foreground" />}
    </div>
    {error && <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p>}
  </div>
}
