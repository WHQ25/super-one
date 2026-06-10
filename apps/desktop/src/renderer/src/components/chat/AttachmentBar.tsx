import { useState } from 'react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { X } from 'lucide-react'
import { PdfThumbnail } from './PdfThumbnail'
import { PdfPreview } from './PdfPreview'
import type { ImageAttachment } from '@superone/shared/agent-types'

interface AttachmentBarProps {
  attachments: ImageAttachment[]
  onRemove?: (index: number) => void
}

export function AttachmentBar({ attachments, onRemove }: AttachmentBarProps) {
  const [preview, setPreview] = useState<ImageAttachment | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {attachments.map((att, i) => (
          <div key={i} className="group relative size-12 overflow-hidden rounded border border-border">
            <button type="button" className="size-full cursor-pointer" onClick={() => setPreview(att)}>
              {att.mimeType === 'application/pdf' ? (
                <PdfThumbnail base64={att.base64} className="size-full" />
              ) : (
                <img src={`data:${att.mimeType};base64,${att.base64}`} alt={att.name} className="size-full object-cover" />
              )}
            </button>
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(i) }}
                className="absolute right-0.5 top-0.5 hidden rounded-full bg-destructive p-0.5 group-hover:block"
              >
                <X className="size-2.5 text-destructive-foreground" />
              </button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <DialogTitle className="truncate text-sm font-medium">{preview?.name}</DialogTitle>
            <DialogClose asChild>
              <IconButton size="sm">
                <X />
              </IconButton>
            </DialogClose>
          </div>
          {preview?.mimeType === 'application/pdf' ? (
            <PdfPreview base64={preview.base64} />
          ) : preview ? (
            <img src={`data:${preview.mimeType};base64,${preview.base64}`} alt={preview.name} className="max-h-[85vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
