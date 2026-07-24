import { describe, expect, it } from 'vitest'
import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { resolveSlashCommandsForProvider } from './resolveSlashCommandsForProvider'

const claude: SlashCommandInfo[] = [
  { name: 'clear', description: 'Clear', argumentHint: '', isSkill: false },
  { name: 'compact', description: 'Compact', argumentHint: '', isSkill: false },
  { name: 'tdd', description: 'TDD skill', argumentHint: '', isSkill: true },
  { name: 'release', description: 'Release skill', argumentHint: '', isSkill: true },
]

const codex: SlashCommandInfo[] = [
  { name: 'review', description: 'Review', argumentHint: '', isSkill: false },
]

const acp: SlashCommandInfo[] = [
  { name: 'web', description: 'Search', argumentHint: 'q', isSkill: false },
  { name: 'clear', description: 'Clear', argumentHint: '', isSkill: false },
]

const opencode: SlashCommandInfo[] = [
  { name: 'deploy', description: 'Deploy', argumentHint: 'env', isSkill: true },
]

const catalogs = { claude, codex, acp, opencode }

describe('resolveSlashCommandsForProvider', () => {
  it('returns Claude project slashCommands for claude', () => {
    expect(resolveSlashCommandsForProvider('claude', catalogs)).toBe(claude)
  })

  it('returns Codex catalog for codex', () => {
    expect(resolveSlashCommandsForProvider('codex', catalogs)).toBe(codex)
  })

  it('returns ACP catalog only — never Claude skills/commands', () => {
    const result = resolveSlashCommandsForProvider('acp', catalogs)
    expect(result).toBe(acp)
    expect(result.some((c) => c.isSkill)).toBe(false)
    expect(result.map((c) => c.name)).toEqual(['web', 'clear'])
    expect(result.map((c) => c.name)).not.toContain('tdd')
    expect(result.map((c) => c.name)).not.toContain('compact')
    expect(result.map((c) => c.name)).not.toContain('release')
  })

  it('returns the OpenCode SDK command catalog', () => {
    expect(resolveSlashCommandsForProvider('opencode', catalogs)).toBe(opencode)
  })
})
