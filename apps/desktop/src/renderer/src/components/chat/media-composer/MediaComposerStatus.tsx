import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { MediaComposerKind } from '@superone/shared/media-composer'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'

export function StatusAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button size="sm" variant="ghost" className={cn('h-5 shrink-0 px-1.5 text-xs text-muted-foreground', className)} {...props} />
}

/** Model availability and setup live in the model selector, outside the prompt layout. */
export function MediaModelStatus({ kind, loading, error }: {
  kind: MediaComposerKind
  loading?: boolean
  error?: string
}) {
  const { t } = useTranslation()
  return <div className="flex flex-col gap-2 px-2 py-2 text-xs text-muted-foreground">
    {loading ? <span role="status" className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />{t('mediaComposer.loading')}</span>
      : <>
        <span>{t(kind === 'image' ? 'mediaComposer.noImageModels' : 'mediaComposer.noVideoModels')}</span>
        {error && <span role="alert" className="break-words text-destructive">{error}</span>}
      </>}
  </div>
}

/** The row under the media composer box: generation progress and errors. */
export function MediaComposerStatus({ error, busyLabel, children }: {
  error?: string
  busyLabel?: string
  children?: ReactNode
}) {
  return <>
    {busyLabel && <span role="status" className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />{busyLabel}</span>}
    {children}
    {error && <span role="alert" title={error} className="min-w-0 truncate text-destructive">{error}</span>}
  </>
}
