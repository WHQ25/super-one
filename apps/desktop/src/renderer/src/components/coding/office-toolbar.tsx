import { useTranslation } from 'react-i18next'
import { FileX2, Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'

export function OfficePreviewStatus({ phase, onRetry }: { phase: 'loading' | 'failed' | 'too-large'; onRetry?: () => void }) {
  const { t } = useTranslation()
  const label = phase === 'loading'
    ? t('filePreview.office.loading')
    : phase === 'too-large'
      ? t('filePreview.tooLarge')
      : t('filePreview.office.failed')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {phase === 'loading' ? <Loader2 className="size-5 animate-spin" /> : <FileX2 className="size-8 opacity-30" />}
      <span className="text-xs">{label}</span>
      {phase === 'failed' && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
