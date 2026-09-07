import type { HarnessId, SlashCommandInfo } from '@superone/shared/agent-types'
import { matchAndRankSlashCommands, type MatchedSlashCommand } from '@superone/shared/slash-command-match'
import { firstLine } from './composer-first-line'

export type { MatchedSlashCommand, SlashCommandInfo }

export function parseSlashCommand(item: unknown, skillNames: Set<string> = new Set()): SlashCommandInfo {
  if (typeof item === 'string') {
    return { name: item, description: '', argumentHint: '', isSkill: skillNames.has(item) }
  }
  const map = (item ?? {}) as Record<string, unknown>
  const name = String(map.name ?? '')
  return {
    name,
    description: String(map.description ?? ''),
    argumentHint: String(map.argumentHint ?? ''),
    isSkill: typeof map.isSkill === 'boolean' ? map.isSkill : skillNames.has(name),
  }
}

export function mergeSlashCatalogs(
  systemCommands: unknown[],
  projectCommands: unknown[],
  skills: unknown[],
): SlashCommandInfo[] {
  const merged = new Map<string, SlashCommandInfo>()
  const add = (items: unknown[], isSkill = false) => {
    for (const item of items) {
      const command = parseSlashCommand(item)
      if (!command.name) continue
      merged.set(command.name, isSkill ? { ...command, isSkill: true } : command)
    }
  }
  add(systemCommands)
  add(projectCommands)
  add(skills, true)
  return [...merged.values()]
}

/**
 * Decide whether the draft is a command query, then rank it with the shared
 * matcher — the same split the desktop uses, so the two cannot drift on which
 * group leads or which characters highlight.
 *
 * Only the **first line** is a query. Later lines are message body: a draft of
 * `/review\nlook at the diff` is still a command with context under it, and
 * matching the whole string would close the overlay the moment the user pressed
 * return.
 *
 * Codex is the one harness whose commands legitimately contain spaces
 * (`auth auto`), and the only one that still shows `debug` / `keybindings-help`.
 */
export function filterSlashCommands(
  text: string,
  commands: readonly SlashCommandInfo[],
  provider?: HarnessId | string,
): MatchedSlashCommand[] {
  if (!text.startsWith('/')) return []
  const line = firstLine(text)
  const isCodex = provider === 'codex'
  if (!isCodex && line.includes(' ')) return []
  return matchAndRankSlashCommands(line.slice(1).toLowerCase(), commands, { includeHidden: isCodex })
}
