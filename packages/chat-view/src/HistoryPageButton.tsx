import { ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function HistoryPageButton({ loading, error, onLoad }: { loading: boolean; error: boolean; onLoad: () => void }) {
  const { t } = useTranslation()
  return <button type="button" disabled={loading} onClick={onLoad}
    className="mx-auto mb-2 flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
    <ChevronUp className="size-3" /> {loading ? t('common.loading') : error ? t('common.retry') : 'Load earlier'}
  </button>
}
