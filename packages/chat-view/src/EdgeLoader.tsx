import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The one indicator each end of the transcript gets.
 *
 * Every page that arrives from above paints here at the top, every page from
 * below at the bottom — history paging, a tick-rail jump, the legacy
 * `loadEarlier` path alike — so two fetches can never show two indicators at
 * one spot, which is what the old fixed pill over the in-flow button did. It
 * has no fill of its own: it reads as part of the transcript, not a control
 * laid over it. Idle and failed requests render nothing; another swipe retries.
 */
export function EdgeLoader({ edge, loading }: {
  edge: 'top' | 'bottom'
  loading: boolean
}) {
  const { t } = useTranslation()
  if (!loading) return null
  return <div role="status" data-testid={`edge-loader-${edge}`} data-loading="true"
    className="my-1 flex items-center justify-center gap-1 px-3 py-1 text-xs text-muted-foreground">
    <Loader2 className="size-3 animate-spin" aria-hidden /> {t('common.loading')}
  </div>
}
