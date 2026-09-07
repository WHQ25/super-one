import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { matchAndRankSlashCommands, type MatchedSlashCommand } from '@superone/shared/slash-command-match'
import type { ChatProvider } from '@/stores/chat'
import { isWorkflowSlashArgsMode } from '../workflow-slash-suggest'

export type { MatchedSlashCommand }

/**
 * Decide whether the draft is a slash-command query, then hand the token after
 * `/` to the shared matcher.
 *
 * Only the first line of `text` is treated as the command query — Tiptap's
 * `getText()` joins block nodes with `\n`, so a multi-line message must not let
 * later lines bleed into the fuzzy match.
 *
 * `/add-dir …` always defers to its stateful popup. Non-Codex paths also bail
 * on any other command line with a space (argument input, not command search).
 * Codex commands legitimately contain spaces (`auth auto`), and Codex is also
 * the one provider that still shows the otherwise-hidden commands.
 */
export function computeMatchingSlashCommands(
  text: string,
  activeSlashCommands: SlashCommandInfo[],
  activeProvider: ChatProvider,
): MatchedSlashCommand[] {
  if (!text.startsWith('/')) return []
  const firstLine = text.split('\n', 1)[0]
  if (/^\/add-dir(\s|$)/.test(firstLine)) return []
  if (activeProvider !== 'codex') {
    // Only after `/workflow ` (space) — bare `/workflow` stays in the slash list
    // so `/workflows` remains visible/selectable.
    if (isWorkflowSlashArgsMode(firstLine)) return []
    if (firstLine.includes(' ')) return []
  }

  return matchAndRankSlashCommands(firstLine.slice(1).toLowerCase(), activeSlashCommands, {
    includeHidden: activeProvider === 'codex',
  })
}
