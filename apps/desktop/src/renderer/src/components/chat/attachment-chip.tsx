import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { X } from 'lucide-react'
import { PdfPreview } from './PdfPreview'
import type { ImageAttachment } from '@superone/shared/agent-types'

/**
 * Inline attachment chip: an image thumbnail (hover to enlarge) or a file-type
 * icon, followed by the file name. Shared by the sent-message renderer and the
 * composer's editor node. Must be wrapped in a `TooltipProvider` by the caller.
 * Pass `onRemove` to show a remove affordance.
 */
export function AttachmentChip({ att, onOpen, onRemove }: { att: ImageAttachment; onOpen: () => void; onRemove?: () => void }) {
  const isPdf = att.mimeType === 'application/pdf'
  const src = `data:${att.mimeType};base64,${att.base64}`
  return (
    <span className="mr-1 mb-0.5 inline-flex max-w-52 items-center gap-1 rounded-md border border-border bg-background/60 py-0.5 pl-0.5 pr-1 align-middle text-xs transition-colors hover:bg-background">
      <button type="button" onClick={onOpen} className="inline-flex min-w-0 cursor-pointer items-center gap-1">
        {isPdf ? (
          <span className="flex size-5 shrink-0 items-center justify-center">
            <FileIcon name={att.name} size={14} />
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <img src={src} alt={att.name} className="size-5 shrink-0 rounded-sm object-cover" />
            </TooltipTrigger>
            <TooltipContent className="overflow-hidden border-0 bg-transparent p-0 shadow-none">
              <img src={src} alt={att.name} className="max-h-64 max-w-64 rounded-md object-contain" />
            </TooltipContent>
          </Tooltip>
        )}
        <span className="truncate">{att.name}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          className="shrink-0 cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** Full-size preview dialog for an attachment (image or PDF). */
export function AttachmentPreviewDialog({ attachment, onClose }: { attachment: ImageAttachment | null; onClose: () => void }) {
  return (
    <Dialog open={!!attachment} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="truncate text-sm font-medium">{attachment?.name}</DialogTitle>
          <DialogClose asChild>
            <IconButton size="sm">
              <X />
            </IconButton>
          </DialogClose>
        </div>
        {attachment?.mimeType === 'application/pdf' ? (
          <PdfPreview base64={attachment.base64} />
        ) : attachment ? (
          <img src={`data:${attachment.mimeType};base64,${attachment.base64}`} alt={attachment.name} className="max-h-[85vh] w-full object-contain" />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
