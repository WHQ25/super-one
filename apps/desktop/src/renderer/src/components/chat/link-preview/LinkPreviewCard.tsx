import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink, Globe, Loader2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { LinkPreviewState } from './link-preview-loader'

export interface LinkPreviewActions {
  onOpenInApp: () => void
  onOpenExternal: () => void
  onCopy: () => Promise<boolean>
}

export function linkHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

/**
 * A web link's hover preview: the site and its actions up front, then the
 * page's Open Graph summary sliding open once it has loaded. A page without
 * one keeps the header alone.
 */
export function LinkPreviewCard({ href, state, favicon, onOpenInApp, onOpenExternal, onCopy }: LinkPreviewActions & {
  href: string
  state: LinkPreviewState
  favicon: ReactNode
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const preview = state.status === 'ready' ? state.preview : null

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 bg-muted/50 py-1.5 pr-1.5 pl-3">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          <span className="flex size-3.5 shrink-0 items-center [&>*]:m-0 [&>*]:size-full">{favicon}</span>
          <span className="truncate" title={href}>{preview?.siteName ?? linkHost(href)}</span>
          {state.status === 'loading' && <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />}
        </span>
        <IconButton size="sm" tooltip={t('chat.linkSafety.openInApp')} onClick={onOpenInApp}><Globe /></IconButton>
        <IconButton size="sm" tooltip={t('chat.linkSafety.openLink')} onClick={onOpenExternal}><ExternalLink /></IconButton>
        <IconButton
          size="sm"
          tooltip={copied ? t('chat.linkSafety.copied') : t('chat.linkSafety.copyLink')}
          onClick={() => void onCopy().then(setCopied)}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      </div>
      <div
        data-state={preview ? 'open' : 'closed'}
        className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100 motion-reduce:transition-none"
      >
        <div className="min-h-0 overflow-hidden">
          {preview && (
            <>
              {preview.image && (
                <img src={preview.image} alt="" className="aspect-[1.91/1] w-full border-y bg-muted object-cover" />
              )}
              {(preview.title || preview.description) && (
                <div className={cn('space-y-1 px-3 py-2.5', !preview.image && 'border-t')}>
                  {preview.title && <div className="line-clamp-2 text-sm font-semibold text-foreground">{preview.title}</div>}
                  {preview.description && <p className="line-clamp-2 text-muted-foreground">{preview.description}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
