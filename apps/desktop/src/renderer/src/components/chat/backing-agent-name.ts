import { backingAgentName } from '@superone/shared/harness/backing-agent-name'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'

/** Display name of the active session's coding agent. */
export function useBackingAgentName(): string {
  const sessionProvider = useActiveSession((session) => session.sessionProvider)
  const preferredProvider = useActiveSession((session) => session.preferredProvider)
  const acpAgentId = useActiveSession((session) => session.acpAgentId)
  const catalogName = useChatStore((state) => {
    const agents = [
      ...(state.harnessResources?.['acp-grok']?.agents ?? []),
      ...(state.harnessResources?.['acp-antigravity']?.agents ?? []),
    ]
    return agents.find((agent) => agent.id === acpAgentId)?.name ?? null
  })
  return backingAgentName({
    provider: resolveProvider({ sessionProvider, preferredProvider }),
    acpAgentId,
    acpAgentCatalogName: catalogName,
  })
}
