import type { SlashCommandInfo } from './agent-types'
import { fuzzyMatch } from './fuzzy-match'

/**
 * Commands whose UX only makes sense in a terminal harness, hidden from the `/`
 * menu. Codex is the exception — see `includeHidden`.
 */
export const HIDDEN_SLASH_COMMANDS: ReadonlySet<string> = new Set(['keybindings-help', 'debug'])

export interface MatchedSlashCommand extends SlashCommandInfo {
  matchIndices: number[]
  score: number
  matched: boolean
}

/**
 * Order matched items into two contiguous groups (commands, skills) and put the
 * group that holds the best-scoring match first. Within a group items are
 * sorted by score. The flat result stays group-contiguous so a grouped popup
 * (`groupItems` + per-group `startIndex`) and keyboard navigation share one
 * index space. An empty query scores everything 0, so ties keep commands ahead
 * of skills — the default ordering when the user has only typed "/".
 */
function rankAndGroup(matched: MatchedSlashCommand[]): MatchedSlashCommand[] {
  const commands = matched.filter((c) => !c.isSkill).sort((a, b) => b.score - a.score)
  const skills = matched.filter((c) => c.isSkill).sort((a, b) => b.score - a.score)
  const bestCommand = commands[0]?.score ?? -Infinity
  const bestSkill = skills[0]?.score ?? -Infinity
  return bestSkill > bestCommand ? [...skills, ...commands] : [...commands, ...skills]
}

/**
 * Filter, score and group a slash catalog against the text typed after `/`.
 *
 * Matches by **name only**. The highlighted characters in a popup come from the
 * name's match indices, so matching on description would surface rows with no
 * visible highlight — a long description fuzzy-matches almost any short query.
 *
 * Deciding *whether* the draft is a command query at all — first line only,
 * bail on a space, defer to a stateful `/add-dir` popup — is caller policy and
 * deliberately stays out of here; the two apps do not agree on it yet.
 *
 * `query` is passed to `fuzzyMatch` as given. That matters: scoring awards a
 * point for an exact-case character, so lowercasing first changes the ranking.
 */
export function matchAndRankSlashCommands(
  query: string,
  commands: readonly SlashCommandInfo[],
  options: { includeHidden?: boolean } = {},
): MatchedSlashCommand[] {
  const pool = options.includeHidden
    ? commands
    : commands.filter((cmd) => !HIDDEN_SLASH_COMMANDS.has(cmd.name))

  const matched = pool
    .map((cmd) => {
      const r = fuzzyMatch(query, cmd.name)
      return { ...cmd, matchIndices: r.indices, score: r.score, matched: r.match }
    })
    .filter((cmd) => cmd.matched)

  return rankAndGroup(matched)
}
