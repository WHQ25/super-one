import { useTranslation } from 'react-i18next'

/** Small, non-blocking feedback: the current transcript remains readable. */
export function NavigationFeedback({ loading, error, onRetry }: { loading: boolean; error: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  if (!loading && !error) return null
  return <div className="fixed top-2 left-1/2 -translate-x-1/2 z-20 w-fit rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground" role="status" data-testid="navigation-feedback">
    {loading ? t('common.loading') : <button type="button" onClick={onRetry}>{t('common.retry')}</button>}
  </div>
}
