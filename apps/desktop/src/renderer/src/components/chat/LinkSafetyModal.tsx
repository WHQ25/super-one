import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation, Trans } from 'react-i18next'
import { ExternalLink, Copy, Check, X, Globe } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { Kbd } from '@superone/ui/components/ui/kbd'

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
          <span>{t('chat.linkSafety.openExternal')}</span>
        </div>

        <div className={cn('break-all rounded-md bg-muted px-3 py-2 font-mono text-xs', url.length > 80 && 'max-h-24 overflow-y-auto')}>
          {url}
        </div>

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
      </div>
    </div>,
    document.body,
  )
}
