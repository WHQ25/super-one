import { useState, useCallback } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { ExternalLink, Copy, Check, Globe } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@superone/ui/components/ui/dialog'

interface LinkSafetyModalProps {
  url: string
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  onOpenInApp?: () => void
}

export function LinkSafetyModal({ url, isOpen, onClose, onConfirm, onOpenInApp }: LinkSafetyModalProps) {
  const { t } = useTranslation()
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

  const handleOpenInApp = useCallback(() => {
    onOpenInApp?.()
    onClose()
  }, [onOpenInApp, onClose])

  // A Radix dialog, not a bare portal: opened from inside another modal dialog
  // (e.g. a Markdown link in the files previewer fullscreen) it must join Radix's
  // layer stack, or the outer dialog's `pointer-events: none` on <body> and its
  // focus trap leave this one visible but dead.
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="flex max-w-sm flex-col gap-3 rounded-xl p-5 sm:max-w-sm [&>[data-slot=dialog-close]]:top-3 [&>[data-slot=dialog-close]]:right-3"
        // Portalled, but React still bubbles through the link's ancestors.
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle className="flex items-center gap-2 text-sm font-medium leading-normal">
          <ExternalLink className="size-4 shrink-0" />
          <span>{t('chat.linkSafety.openExternal')}</span>
        </DialogTitle>

        <DialogDescription className={cn('break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground', url.length > 80 && 'max-h-24 overflow-y-auto')}>
          {url}
        </DialogDescription>

        <div className="flex flex-col gap-2">
          <button
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            onClick={handleCopy}
            type="button"
          >
            {copied
              ? <><Check className="size-3" /><span>{t('chat.linkSafety.copied')}</span></>
              : <><Copy className="size-3" /><span>{t('chat.linkSafety.copyLink')}</span></>
            }
          </button>
          {onOpenInApp && (
            <button
              className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              onClick={handleOpenInApp}
              type="button"
            >
              <Globe className="size-3" />
              <span>{t('chat.linkSafety.openInApp')}</span>
            </button>
          )}
          <button
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            onClick={handleOpen}
            type="button"
          >
            <ExternalLink className="size-3" />
            <span>{t('chat.linkSafety.openLink')}</span>
          </button>
        </div>

        {onOpenInApp && (
          <p className="text-center text-xs text-muted-foreground">
            <Trans
              i18nKey="chat.linkSafety.openInAppHint"
              components={{ key: <Kbd>{window.app.platform === 'darwin' ? '⌘' : 'Ctrl'}</Kbd> }}
            />
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
