import { fuzzyMatch } from '@superone/shared/fuzzy-match'

export type SlashCommand = {
  name: string
  description?: string
  argumentHint?: string
  isSkill?: boolean
}

export type SlashCommandMatch = {
  command: SlashCommand
  nameIndices: number[]
  score: number
}

const HIDDEN = new Set(['debug', 'keybindings-help'])

export function parseSlashCommand(item: unknown, skillNames: Set<string> = new Set()): SlashCommand {
  if (typeof item === 'string') return { name: item, isSkill: skillNames.has(item) }
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
): SlashCommand[] {
  const merged = new Map<string, SlashCommand>()
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

/** Overlay only while the draft is a single `/token` with no space. */
export function filterSlashCommands(
  text: string,
  raw: unknown[],
  skillNames: Set<string> = new Set(),
): SlashCommandMatch[] {
  if (!text.startsWith('/') || /\s/.test(text)) return []
  const query = text.slice(1)
  const commands = raw
    .map((item) => parseSlashCommand(item, skillNames))
    .filter((c) => c.name && !HIDDEN.has(c.name))
  if (query === '') return commands.map((command) => ({ command, nameIndices: [], score: 0 }))
  const matches: SlashCommandMatch[] = []
  for (const command of commands) {
    const nameResult = fuzzyMatch(query, command.name)
    if (!nameResult.match) continue
    matches.push({ command, nameIndices: nameResult.indices, score: nameResult.score })
  }
  matches.sort((a, b) => b.score - a.score)
  return matches
}
