import type { SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'
import { fuzzyMatch } from '../../../lib/fuzzy-match'
function orderCommandsBySkill<T extends { isSkill: boolean }>(commands: T[]): T[] {
  return [...commands.filter((c) => !c.isSkill), ...commands.filter((c) => c.isSkill)]
}

const HIDDEN_COMMANDS = new Set(['keybindings-help', 'debug'])

export interface MatchedSlashCommand extends SlashCommandInfo {
  matchIndices: number[]
  score: number
  matched: boolean
}

/**
 * Filter + score the slash-command list against the current input text.
 *
 * Codex path: matches by name only (Codex command surface is small and
 * descriptions are static help text). Hidden-commands set does not apply
 * because Codex skill list is curated.
 *
 * Claude path: matches by name OR description, hides debug commands, and
 * bails out on `/add-dir …` (a stateful subcommand) plus on any input
 * with a space (treats it as argument input, not command search).
 */
export function computeMatchingSlashCommands(
  text: string,
  activeSlashCommands: SlashCommandInfo[],
  activeProvider: ChatProvider,
): MatchedSlashCommand[] {
  if (activeProvider === 'codex') {
    if (!text.startsWith('/')) return []
    const query = text.slice(1).toLowerCase()
    return orderCommandsBySkill(
      activeSlashCommands
        .map((cmd) => {
          const r = fuzzyMatch(query, cmd.name)
          return { ...cmd, matchIndices: r.indices, score: r.score, matched: r.match }
        })
        .filter((cmd) => cmd.matched)
        .sort((a, b) => b.score - a.score),
    )
  }

  if (!text.startsWith('/')) return []
  if (/^\/add-dir(\s|$)/.test(text)) return []
  if (text.includes(' ')) return []
  const query = text.slice(1).toLowerCase()
  return orderCommandsBySkill(
    activeSlashCommands
      .filter((cmd) => !HIDDEN_COMMANDS.has(cmd.name))
      .map((cmd) => {
        const nameResult = fuzzyMatch(query, cmd.name)
        const descResult = cmd.description ? fuzzyMatch(query, cmd.description) : null
        const bestScore = descResult && descResult.match && descResult.score > nameResult.score
          ? descResult.score
          : nameResult.score
        const matched = nameResult.match || (descResult?.match ?? false)
        return { ...cmd, matchIndices: nameResult.indices, score: bestScore, matched }
      })
      .filter((cmd) => cmd.matched)
      .sort((a, b) => b.score - a.score),
  )
}
