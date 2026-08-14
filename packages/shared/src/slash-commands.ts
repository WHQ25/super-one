import type { SlashCommandInfo } from './agent-types'

/** Strip a leading slash so SDK (`exit`) and UI (`/exit`) names compare equal. */
export function slashCommandKey(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name
}

export function readTerminalSlashCommands(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return names.length > 0 ? names : undefined
}

/** Read `terminal_slash_commands` from a Claude SDK system/init frame. */
export function readTerminalSlashCommandsFromInitMessage(message: unknown): string[] | undefined {
  if (!message || typeof message !== 'object') return undefined
  const raw = message as Record<string, unknown>
  if (raw.type !== 'system' || raw.subtype !== 'init') return undefined
  return readTerminalSlashCommands(raw.terminal_slash_commands)
}

export function markTerminalBoundSlashCommands(
  commands: SlashCommandInfo[],
  terminalNames: readonly string[] | undefined,
): SlashCommandInfo[] {
  if (!terminalNames?.length) return commands
  const tagged = new Set(terminalNames.map(slashCommandKey))
  let changed = false
  const next = commands.map((command) => {
    if (command.terminalBound || !tagged.has(slashCommandKey(command.name))) return command
    changed = true
    return { ...command, terminalBound: true }
  })
  return changed ? next : commands
}
