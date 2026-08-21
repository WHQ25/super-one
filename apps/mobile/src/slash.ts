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

function forwardMatchFrom(queryLower: string, textLower: string, start: number): number[] {
  const indices: number[] = []
  let qi = 0
  for (let pi = start; pi < textLower.length && qi < queryLower.length; pi++) {
    if (textLower[pi] === queryLower[qi]) {
      indices.push(pi)
      qi++
    }
  }
  return indices
}

function scoreIndices(indices: number[], query: string, text: string): number {
  let score = 0
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!
    if (i > 0 && idx === indices[i - 1]! + 1) score += 5
    if (text[idx] === query[i]) score += 1
  }
  if (indices.length > 0 && indices[0] === 0) score += 10
  score -= text.length * 0.1
  return score
}

export function fuzzyMatch(query: string, text: string): { match: boolean; score: number; indices: number[] } {
  if (query === '') return { match: true, score: 0, indices: [] }
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  const fwd = forwardMatchFrom(queryLower, textLower, 0)
  if (fwd.length < queryLower.length) return { match: false, score: 0, indices: [] }
  let bestIndices = fwd
  let bestScore = scoreIndices(fwd, query, text)
  for (let pi = 1; pi < textLower.length; pi++) {
    if (textLower[pi] !== queryLower[0]) continue
    const candidate = forwardMatchFrom(queryLower, textLower, pi)
    if (candidate.length < queryLower.length) continue
    const s = scoreIndices(candidate, query, text)
    if (s > bestScore) {
      bestScore = s
      bestIndices = candidate
    }
  }
  return { match: true, score: bestScore, indices: bestIndices }
}

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

/** Overlay only while the draft is a single `/token` with no space. */
export function filterSlashCommands(
  text: string,
  raw: unknown[],
  skillNames: Set<string> = new Set(),
): SlashCommandMatch[] {
  if (!text.startsWith('/') || text.includes(' ')) return []
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
