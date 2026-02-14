import type { SlashCommandInfo } from '../../../shared/agent-types'

/** Merge global slash commands with user/project skills and commands, deduplicating by name. */
export function buildSlashCommands(
  globalSlashCommands: SlashCommandInfo[],
  userSkills: SlashCommandInfo[],
  userCommands: SlashCommandInfo[],
  projectSkills: SlashCommandInfo[],
  projectCommands: SlashCommandInfo[],
): SlashCommandInfo[] {
  const skillSet = new Set([...userSkills, ...projectSkills].map((sk) => sk.name))
  const tagged = globalSlashCommands.map((c) => ({ ...c, isSkill: skillSet.has(c.name) }))
  const seen = new Set(tagged.map((c) => c.name))
  const extra: SlashCommandInfo[] = []
  for (const c of [...userSkills, ...userCommands, ...projectSkills, ...projectCommands]) {
    if (!seen.has(c.name)) {
      seen.add(c.name)
      extra.push(c)
    }
  }
  return [...tagged, ...extra]
}

/** Commands that render as a lightweight popup near the input area. Everything else uses full overlay. */
const POPUP_COMMANDS = new Set(['help', 'reset', 'auth', 'auth-status', 'auth-set'])

export function getCommandOutputMode(command: string): 'overlay' | 'popup' {
  return POPUP_COMMANDS.has(command) ? 'popup' : 'overlay'
}
