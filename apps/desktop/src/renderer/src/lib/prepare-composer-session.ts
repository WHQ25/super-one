import { useChatStore } from '@/stores/chat'
import type { SessionWriteTarget } from '@/stores/chat-store/types'
import { createSendWriteScope } from '@/stores/chat-store/helpers/send-write-scope'
import { applyPendingWorktree, ensureHostSession } from '@/stores/chat-store/helpers/session-turn'

/** Voice and scheduling preserve the draft, but need the host session a first turn creates. */
export async function prepareComposerSession(projectPath: string, target?: SessionWriteTarget): Promise<string | null> {
  const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, projectPath, target)
  if (!await applyPendingWorktree(projectPath, scope)) return null
  return ensureHostSession(useChatStore.setState, useChatStore.getState, projectPath, scope, { requireActivation: true })
}
