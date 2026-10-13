import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import type { ScheduledSendView } from './protocol'
import { postHost } from './bridge'
import { SCHEDULED_SEND_DEFAULT_MESSAGE } from '@superone/shared/agent-types'

/** Mobile-only quota recovery, enabled by the native host and scrolling with the transcript. */
export function PortableScheduledResumeCard({ state, locale }: { state: ScheduledSendView | null; locale: 'en' | 'zh' }) {
  const { i18n } = useTranslation()
  const t = i18n.getFixedT(locale)
  const scheduled = state?.scheduled
  if (!scheduled || scheduled.source !== 'rate_limit' || scheduled.armed) return null
  const time = new Date(scheduled.sendAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const disabled = !state.available || state.busy
  const act = (action: 'accept' | 'dismiss') => postHost({ type: 'scheduledSendAction', action, sessionId: scheduled.sessionId, sendAt: scheduled.sendAt })
  return <section data-testid="scheduled-resume-card" className="my-3 w-full rounded-xl border border-border bg-card p-3 text-sm">
    <div className="flex items-center gap-2" aria-live="polite">
      <Clock className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="font-medium">{t('chat.scheduledSend.continueOnReset')}</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{t('chat.scheduledSend.sendAt', { time })}</p>
    <p className="mt-1 text-xs text-muted-foreground">{t('chat.scheduledSend.explainOffer', { fallback: SCHEDULED_SEND_DEFAULT_MESSAGE })}</p>
    {state.error && <p role="alert" className="mt-2 text-xs text-destructive">{state.error}</p>}
    <div className="mt-3 flex items-stretch justify-between gap-2">
      <Button className="h-11 min-w-0 flex-1 bg-success text-success-foreground hover:bg-success/90 focus-visible:border-success focus-visible:ring-success/50" disabled={disabled} onClick={() => act('accept')}>{t('common.confirm')}</Button>
      <Button variant="destructive" className="h-11 min-w-0 flex-1" disabled={disabled} onClick={() => act('dismiss')}>{t('common.cancel')}</Button>
    </div>
  </section>
}
