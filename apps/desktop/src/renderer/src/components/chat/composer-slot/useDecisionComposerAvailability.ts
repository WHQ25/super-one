import { useActiveSession, useIsRemoteLocked } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useProjectHarnessCatalog } from '@/hooks/use-project-harness-catalog'
import { catalogIdForSessionProvider, isCatalogHarnessDisabled } from '@/lib/harness-visibility'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'

/** Read-only sessions keep their existing lock surfaces above pending prompts. */
export function useDecisionComposerAvailability(): boolean {
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const isRemoteLocked = useIsRemoteLocked()
  const harnessCatalog = useProjectHarnessCatalog(useAppStore((s) => s.harnessCatalog))
  const provider = resolveProvider({ sessionProvider, preferredProvider })
  const catalogId = catalogIdForSessionProvider(provider, acpAgentId)
  const harnessDisabled = catalogId != null && isCatalogHarnessDisabled(harnessCatalog, catalogId)
  return !worktreeRemoved && !harnessDisabled && !isRemoteLocked
}
