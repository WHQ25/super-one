import { useEffect, useRef, useState } from 'react'
import { useActiveSession } from '@/stores/chat'
import { SubscriptionAlertLedger, selectSubscriptionAlert, type LiveUsageLimit, type SubscriptionAlert } from '@superone/shared/subscription-alerts'
import type { UsageWindow } from '@superone/shared/subscription-usage'

// Survives switching projects and remounting the sidebar. No session ID in a quota episode.
export const subscriptionAlertLedger = new SubscriptionAlertLedger()

export function useSubscriptionAlert(account: string, windows: readonly UsageWindow[], live: LiveUsageLimit | null, loaded: boolean) {
  const sessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? null)
  const model = useActiveSession((s) => s.selectedModel)
  const previous = useRef<{ account: string; sessionId: string | null; alert: SubscriptionAlert | null } | null>(null)
  const [visible, setVisible] = useState<{ account: string; alert: SubscriptionAlert; until: number } | null>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const candidate = selectSubscriptionAlert(windows, live, now, model)
  const candidateKey = candidate ? JSON.stringify([candidate.windowId, candidate.resetsAt, candidate.severity]) : null
  useEffect(() => {
    const last = previous.current
    // A served request ends a rejection on that session. Merely selecting another session does not.
    if (!live && last?.alert?.status === 'rejected' && last.account === account && last.sessionId === sessionId) {
      subscriptionAlertLedger.endRejection(account, last.alert.windowId)
    }
    previous.current = { account, sessionId, alert: candidate }
    subscriptionAlertLedger.recover(account, windows, Date.now())
    // Wait for the initial meter before showing an early warning; actual rejection never waits.
    if (!candidate || (!loaded && candidate.status !== 'rejected')) {
      setVisible(null)
      return
    }
    if (subscriptionAlertLedger.claim(account, candidate, Date.now())) {
      setVisible({ account, alert: candidate, until: Date.now() + 6_000 })
    }
  }, [account, candidateKey, loaded, windows, now, sessionId, live]) // Forecast values update without restarting the bubble.
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => setVisible(null), Math.max(0, visible.until - Date.now()))
    return () => window.clearTimeout(timer)
  }, [visible])
  return visible?.account === account && candidateKey != null ? visible.alert : null
}
