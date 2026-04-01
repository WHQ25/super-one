import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Check, Copy, X } from 'lucide-react'

interface PasteChipPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  text: string
  lineCount: number
}

export function PasteChipPreview({ open, onOpenChange, text, lineCount }: PasteChipPreviewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [text])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="text-sm font-medium">
            Pasted text · {lineCount} lines
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </Button>
            </DialogClose>
          </div>
        </div>
        <div className="overflow-auto p-4" style={{ maxHeight: 'calc(90vh - 49px)' }}>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">{text}</pre>
        </div>
      </DialogContent>
    </Dialog>
  )
}
