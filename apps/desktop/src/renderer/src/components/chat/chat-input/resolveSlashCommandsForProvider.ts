import type { SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'

/**
 * Pick the slash-command catalog for the active harness.
 * ACP must never fall through to project-level Claude slashCommands/skills.
 */
export function resolveSlashCommandsForProvider(
  provider: ChatProvider,
  catalogs: {
    claude: SlashCommandInfo[]
    codex: SlashCommandInfo[]
    acp: SlashCommandInfo[]
    opencode: SlashCommandInfo[]
  },
): SlashCommandInfo[] {
  switch (provider) {
    case 'codex':
      return catalogs.codex
    case 'acp':
      return catalogs.acp
    case 'opencode':
      return catalogs.opencode
    case 'cursor':
      return []
    case 'claude':
    default:
      return catalogs.claude
  }
}
