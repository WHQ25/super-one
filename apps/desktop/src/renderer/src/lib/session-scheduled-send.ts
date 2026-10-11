import { useChatStore } from '@/stores/chat'
import type { SessionWriteTarget } from '@/stores/chat-store/types'
import { createSendWriteScope } from '@/stores/chat-store/helpers/send-write-scope'
import { applyPendingWorktree, ensureHostSession } from '@/stores/chat-store/helpers/session-turn'

/** Scheduling preserves the draft, but needs the same host session a first turn creates. */
export async function prepareScheduledSession(projectPath: string, target?: SessionWriteTarget): Promise<string | null> {
  const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, projectPath, target)
  if (!await applyPendingWorktree(projectPath, scope)) return null
  return ensureHostSession(useChatStore.setState, useChatStore.getState, projectPath, scope)
}
