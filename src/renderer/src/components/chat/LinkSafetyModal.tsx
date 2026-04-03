import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Copy, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LinkSafetyModalProps {
  url: string
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

export function LinkSafetyModal({ url, isOpen, onClose, onConfirm }: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [url])

  const handleOpen = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative mx-4 flex w-full max-w-sm flex-col gap-3 rounded-xl border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium">
          <ExternalLink className="size-4 shrink-0" />
          <span>Open external link?</span>
        </div>

        <div className={cn('break-all rounded-md bg-muted px-3 py-2 font-mono text-xs', url.length > 80 && 'max-h-24 overflow-y-auto')}>
          {url}
        </div>

        <div className="flex gap-2">
          <button
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            onClick={handleCopy}
            type="button"
          >
            {copied
              ? <><Check className="size-3" /><span>Copied</span></>
              : <><Copy className="size-3" /><span>Copy link</span></>
            }
          </button>
          <button
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={handleOpen}
            type="button"
          >
            <ExternalLink className="size-3" />
            <span>Open link</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
