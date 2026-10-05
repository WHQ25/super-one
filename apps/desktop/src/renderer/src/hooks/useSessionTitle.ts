import { useChatStore } from '@/stores/chat'
import { selectSessionTitle } from '@/lib/session-title'

export function useSessionTitle(
  projectPath: string | null | undefined,
  sessionId: string | null | undefined,
  persistedTitle?: string | null,
): string {
  return useChatStore((state) => selectSessionTitle(state, projectPath, sessionId, persistedTitle))
}
