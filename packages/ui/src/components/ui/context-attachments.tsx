import { AppWindow, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { cn } from '../../lib/utils'
import { McpAppIcon } from './mcp-app-icon'

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
  const [openId, setOpenId] = useState<string | null>(null)
  const open = items.find(item => item.id === openId)
  if (!items.length && !loading && !error) return null
  // One preview, anchored to the whole chip row: it spans the composer and follows its width.
  return <Popover open={!!open} onOpenChange={value => { if (!value) setOpenId(null) }}>
    <PopoverAnchor asChild>
      <div className={cn('min-w-0', className)}>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {items.map(item => <span key={item.id} data-context-attachment className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap select-none">
            <button type="button" data-context-attachment-trigger aria-haspopup="dialog" aria-expanded={openId === item.id} onClick={() => setOpenId(value => value === item.id ? null : item.id)}
              className="flex min-w-0 cursor-pointer items-center gap-1 text-left" aria-label={item.title}>
              <McpAppIcon src={item.icon} className="size-3 shrink-0 text-muted-foreground" fallback={!item.thumbnail && <AppWindow className="size-3 shrink-0 text-muted-foreground" />} />
              {item.thumbnail && <img src={item.thumbnail} alt="" referrerPolicy="no-referrer" className="size-4 shrink-0 rounded-sm object-cover" />}
              {item.source && <>
                <span className="max-w-35 shrink-0 truncate font-medium text-foreground">{item.source}</span>
                <span className="text-[10px] text-muted-foreground">·</span>
              </>}
              <span className="min-w-0 max-w-60 truncate text-[11px] text-muted-foreground">{item.title}</span>
            </button>
            {onRemove && <button type="button" disabled={removing.includes(item.id)} aria-label={`${removeLabel}: ${item.title}`} onClick={() => onRemove(item.id)} className="ml-0.5 shrink-0 cursor-pointer text-muted-foreground/70 hover:text-foreground disabled:opacity-50">
              {removing.includes(item.id) ? <Loader2 className="size-2.5 animate-spin" /> : <X className="size-2.5" />}
            </button>}
          </span>)}
          {loading && <Loader2 aria-label="Loading attachments" className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {error && <p role="alert" className="mt-1 break-words text-xs text-destructive">{error}</p>}
      </div>
    </PopoverAnchor>
    {/* As wide as the chip row (the composer), between 16rem and 40rem, never past the room the screen leaves. */}
    <PopoverContent side="top" align="start" className="w-(--radix-popover-trigger-width) min-w-64 max-w-[min(40rem,var(--radix-popover-content-available-width))] p-3"
      onOpenAutoFocus={event => event.preventDefault()}
      // A chip toggles its own preview; the dismiss on its pointerdown would reopen it on click.
      onInteractOutside={event => { if ((event.target as Element | null)?.closest('[data-context-attachment-trigger]')) event.preventDefault() }}>
      {open && <>
        {/* Who it came from; what it is follows in the content itself. */}
        <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <McpAppIcon src={open.icon} className="size-3.5 shrink-0 text-muted-foreground" fallback={<AppWindow className="size-3.5 shrink-0 text-muted-foreground" />} />
          <span className="min-w-0 truncate">{open.source ?? open.title}</span>
        </div>
        {open.previewImages?.map((preview, index) => <img key={index} src={preview.src} alt={preview.alt} referrerPolicy="no-referrer" className="mb-2 max-h-[min(16rem,40vh)] w-full rounded object-contain" />)}
        {open.content && <pre className="max-h-[min(24rem,50vh)] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">{open.content}</pre>}
      </>}
    </PopoverContent>
  </Popover>
}
