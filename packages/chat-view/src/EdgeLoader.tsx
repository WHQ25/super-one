import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The one indicator each end of the transcript gets.
 *
 * Every page that arrives from above paints here at the top, every page from
 * below at the bottom — history paging, a tick-rail jump, the legacy
 * `loadEarlier` path alike — so two fetches can never show two indicators at
 * one spot, which is what the old fixed pill over the in-flow button did. It
 * has no fill of its own: it reads as part of the transcript, not a control
 * laid over it. The idle label stays because a transcript shorter than the
 * viewport never scrolls, and then a tap is the only way to reach more history.
 */
export function EdgeLoader({ edge, loading, error, onLoad }: {
  edge: 'top' | 'bottom'
  loading: boolean
  error: boolean
  onLoad: () => void
}) {
  const { t } = useTranslation()
  const Chevron = edge === 'top' ? ChevronUp : ChevronDown
  return <button type="button" disabled={loading} onClick={onLoad} data-testid={`edge-loader-${edge}`} data-loading={loading || undefined}
    className="mx-auto my-1 flex items-center gap-1 px-3 py-1 text-xs text-muted-foreground">
    {loading
      ? <><Loader2 className="size-3 animate-spin" aria-hidden /> {t('common.loading')}</>
      : error
        ? t('common.retry')
        : <><Chevron className="size-3" aria-hidden /> {edge === 'top' ? 'Load earlier' : 'Load later'}</>}
  </button>
}
