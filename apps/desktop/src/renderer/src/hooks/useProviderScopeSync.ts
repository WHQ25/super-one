import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { subscriptionHost } from '@/lib/provider-host'

/**
 * Keep the global provider store on the machine the focused chat runs on.
 * Every writer must derive the scope the same way: two mounted components
 * that disagree (e.g. the sidebar host switched before the project followed)
 * would flip the scope back and forth until React aborts the render.
 */
export function useProviderScopeSync(): void {
  const activeProject = useChatStore((s) => s.activeProject)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const providerScope = useSettingsStore((s) => s.providerScope)
  const next = subscriptionHost(activeProject, selectedHostConnectionId) ?? 'local'
  useEffect(() => {
    if (next === providerScope) return
    const { setProviderScope } = useSettingsStore.getState()
    if (typeof setProviderScope === 'function') setProviderScope(next)
  }, [next, providerScope])
}
