import type { SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'

/**
 * Pick the slash-command catalog for the active harness.
 * Every harness must declare its own catalog so none can inherit Claude
 * project commands or skills by falling through a default branch.
 */
export function resolveSlashCommandsForProvider(
  provider: ChatProvider,
  catalogs: Record<ChatProvider, SlashCommandInfo[]>,
): SlashCommandInfo[] {
  return catalogs[provider]
}
