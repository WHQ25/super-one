import type { SlashCommandInfo } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'
import { fuzzyMatch } from '../../../lib/fuzzy-match'

const HIDDEN_COMMANDS = new Set(['keybindings-help', 'debug'])

export interface MatchedSlashCommand extends SlashCommandInfo {
  matchIndices: number[]
  score: number
  matched: boolean
}

/**
 * Order matched items into two contiguous groups (commands, skills) and put the
 * group that holds the best-scoring match first. Within a group items are
 * sorted by score. The flat result stays group-contiguous so the grouped popup
 * (groupItems + per-group startIndex) and keyboard navigation share one index
 * space. An empty query scores everything 0, so ties keep commands ahead of
 * skills — the default ordering when the user has only typed "/".
 */
function rankAndGroup(matched: MatchedSlashCommand[]): MatchedSlashCommand[] {
  const commands = matched.filter((c) => !c.isSkill).sort((a, b) => b.score - a.score)
  const skills = matched.filter((c) => c.isSkill).sort((a, b) => b.score - a.score)
  const bestCommand = commands[0]?.score ?? -Infinity
  const bestSkill = skills[0]?.score ?? -Infinity
  return bestSkill > bestCommand ? [...skills, ...commands] : [...commands, ...skills]
}

/**
 * Filter + score the slash-command list against the current input text.
 *
 * Matches by name only — the highlighted characters in the popup come from the
 * name match indices, so matching on description would surface items with no
 * visible highlight (a long description fuzzy-matches almost any short query).
 *
 * Only the first line of `text` is treated as the command query — Tiptap's
 * `getText()` joins block nodes with `\n`, so a multi-line message must not let
 * later lines bleed into the fuzzy match.
 *
 * Claude path additionally hides debug commands, bails on `/add-dir …` (a
 * stateful subcommand) and on any command line with a space (argument input,
 * not command search). Codex commands legitimately contain spaces (`auth
 * auto`), so the space/add-dir guards do not apply there.
 */
export function computeMatchingSlashCommands(
  text: string,
  activeSlashCommands: SlashCommandInfo[],
  activeProvider: ChatProvider,
): MatchedSlashCommand[] {
  if (!text.startsWith('/')) return []
  const firstLine = text.split('\n', 1)[0]
  if (activeProvider !== 'codex') {
    if (/^\/add-dir(\s|$)/.test(firstLine)) return []
    if (firstLine.includes(' ')) return []
  }

  const query = firstLine.slice(1).toLowerCase()
  const pool =
    activeProvider === 'codex'
      ? activeSlashCommands
      : activeSlashCommands.filter((cmd) => !HIDDEN_COMMANDS.has(cmd.name))

  const matched = pool
    .map((cmd) => {
      const r = fuzzyMatch(query, cmd.name)
      return { ...cmd, matchIndices: r.indices, score: r.score, matched: r.match }
    })
    .filter((cmd) => cmd.matched)

  return rankAndGroup(matched)
}
