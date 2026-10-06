import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { MediaComposerKind } from '@superone/shared/media-composer'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { openProviderSettings } from './use-media-composer'

export function StatusAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button size="sm" variant="ghost" className={cn('h-5 shrink-0 px-1.5 text-xs text-muted-foreground', className)} {...props} />
}

/** The row under the media composer box: model availability, progress, and errors. */
export function MediaComposerStatus({ kind, loading, hasModels, error, onRetry, busyLabel, children }: {
  kind: MediaComposerKind
  loading: boolean
  hasModels: boolean
  error?: string
  onRetry: () => void
  busyLabel?: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return <>
    {loading ? <span role="status">{t('mediaComposer.loading')}</span>
      : !hasModels ? <>
        <span className="truncate">{t(kind === 'image' ? 'mediaComposer.noImageModels' : 'mediaComposer.noVideoModels')}</span>
        <StatusAction onClick={openProviderSettings}>{t('mediaComposer.settings')}</StatusAction>
        <StatusAction onClick={onRetry}>{t('mediaComposer.retry')}</StatusAction>
      </>
      : busyLabel ? <span role="status" className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />{busyLabel}</span>
      : null}
    {children}
    {error && <span role="alert" title={error} className="min-w-0 truncate text-destructive">{error}</span>}
  </>
}
