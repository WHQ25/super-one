import type { ChatMessage, SlashCommandInfo } from '@superone/shared/agent-types'

/** Merge global slash commands with user/project skills and commands, deduplicating by name. */
export function buildSlashCommands(
  globalSlashCommands: SlashCommandInfo[],
  userSkills: SlashCommandInfo[],
  userCommands: SlashCommandInfo[],
  projectSkills: SlashCommandInfo[],
  projectCommands: SlashCommandInfo[],
  disabledSkills: ReadonlySet<string> = new Set(),
): SlashCommandInfo[] {
  const allSkills = [...userSkills, ...projectSkills]
  const skillMap = new Map(allSkills.map((sk) => [sk.name, sk]))
  // SuperOne intercepts `/clear` to reset the session; drop the SDK's built-in
  // `/clear` (it carries a misleading `[name]` argument hint that does nothing
  // here) and re-add it as a local-only command below.
  const tagged = globalSlashCommands.flatMap((c): SlashCommandInfo[] => {
    if (c.name === 'clear') return []
    const skill = skillMap.get(c.name)
    if (skill) {
      if (disabledSkills.has(c.name)) return []
      return [{ ...c, isSkill: true, argumentHint: c.argumentHint || skill.argumentHint }]
    }
    return [c]
  })
  const seen = new Set(tagged.map((c) => c.name))
  const extra: SlashCommandInfo[] = []
  for (const c of [...userSkills, ...userCommands, ...projectSkills, ...projectCommands]) {
    if (seen.has(c.name)) continue
    if (c.isSkill && disabledSkills.has(c.name)) continue
    seen.add(c.name)
    extra.push(c)
  }
  // Local-only commands (handled in renderer, not sent to agent)
  if (!seen.has('clear')) {
    extra.push({ name: 'clear', description: 'Clear the conversation and start fresh', argumentHint: '', isSkill: false })
  }
  if (!seen.has('add-dir')) {
    extra.push({ name: 'add-dir', description: 'Manage additional working directories', argumentHint: '[project|session] [dir]', isSkill: false })
  }
  // /provider command retired — provider selection moved into the model selector (kept for reference)
  // if (!seen.has('provider')) {
  //   extra.push({ name: 'provider', description: 'Choose API provider for this session', argumentHint: '', isSkill: false })
  // }
  if (!seen.has('mcp')) {
    extra.push({ name: 'mcp', description: 'View MCP servers in this session', argumentHint: '', isSkill: false })
  }
  if (!seen.has('workflows')) {
    extra.push({
      name: 'workflows',
      description: 'Show workflow runs in this session',
      argumentHint: '',
      isSkill: false,
    })
  }
  return [...tagged, ...extra]
}

/**
 * Find the index of the user message that should receive a checkpoint.
 * Returns -1 if no suitable user message is found.
 */
export function findCheckpointTarget(messages: ChatMessage[], assistantMessageId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === assistantMessageId) {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') return j
      }
      break
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
}

/** Remap message IDs for a forked session to avoid DB upsert conflicts. */
export function remapMessagesForFork(messages: ChatMessage[], forkedSessionId: string): ChatMessage[] {
  return messages.map((m) => ({ ...m, id: `${forkedSessionId}_${m.id}` }))
}

export function extractModeFromSuggestions(
  suggestions: Array<Record<string, unknown>> | undefined,
  selectedIndices: number[]
): string | undefined {
  if (!suggestions) return undefined
  let mode: string | undefined
  for (const idx of selectedIndices) {
    const s = suggestions[idx]
    if (s?.type === 'setMode' && typeof s.mode === 'string') {
      mode = s.mode
    }
  }
  return mode
}
