import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useChatStore } from '@/stores/chat'

/** Both selectors refresh the same native catalog, with feedback in their own vocabulary. */
export function useOpenCodeResourceRefresh(kind: 'models' | 'agents') {
  const { t } = useTranslation()
  const inFlight = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setHarnessResources = useChatStore((state) => state.setHarnessResources)
  const refresh = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const fresh = await window.app.connectOpenCode(true)
      setHarnessResources('opencode', fresh)
      toast.success(t(`chat.opencode.${kind}Refreshed`, { count: fresh[kind].length }))
    } catch {
      const message = t(`chat.opencode.${kind}RefreshFailed`)
      setError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }
  return { refresh, loading, error }
}
