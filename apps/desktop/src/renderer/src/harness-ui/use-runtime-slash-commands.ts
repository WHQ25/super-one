import type { HarnessId, SlashCommandInfo } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { ChatStore } from '@/stores/chat-store/types'

/** A live catalog is scoped to the composer session, including side chats. */
export function useRuntimeSlashCommands(harnessId: HarnessId, fallback: (state: ChatStore) => SlashCommandInfo[]): SlashCommandInfo[] {
  const catalog = useChatStore(fallback)
  const native = useActiveSession((session) => session.runtimeCapabilities?.harnessId === harnessId ? session.sessionSlashCommands : undefined)
  return native ?? catalog
}
