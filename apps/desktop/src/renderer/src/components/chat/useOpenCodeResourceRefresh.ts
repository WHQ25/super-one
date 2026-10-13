import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'
import { callSession } from '@/lib/session-client'
import { useEnvironmentServes } from '@/hooks/use-environment-serves'
import { ownsOpenCodeSession } from '@/harness-ui/opencode/session-resources'

/** Both selectors refresh the same native catalog, with feedback in their own vocabulary. */
export function useOpenCodeResourceRefresh(kind: 'models' | 'agents') {
  const { t } = useTranslation()
  const inFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setHarnessResources = useChatStore((state) => state.setHarnessResources)
  const scope = useSessionScope()
  const project = useChatStore((state) => state.activeProject)
  const sessionId = useActiveSession((state) => scope?.sessionId ?? state._activeSessionId)
  const ownsSession = useActiveSession(ownsOpenCodeSession)
  const path = scope?.projectPath ?? project
  const canRefresh = useEnvironmentServes(path, 'session.refreshResources')
  const refresh = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const native = path && sessionId && ownsSession && canRefresh ? await callSession(path, sessionId, 'session.refreshResources', {}) : null
      const fresh = native?.opencode ?? await window.app.connectOpenCode(true)
      setHarnessResources('opencode', fresh)
      toast.success(t(`chat.opencode.${kind}Refreshed`, { count: fresh[kind].length }))
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t(`chat.opencode.${kind}RefreshFailed`)
      setError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }
  return { refresh, loading, error }
}
