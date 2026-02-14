import { describe, expect, it } from 'vitest'
import { buildSlashCommands, getCommandOutputMode } from './chat-helpers'
import type { SlashCommandInfo } from '../../../shared/agent-types'

function cmd(name: string, description = ''): SlashCommandInfo {
  return { name, description, argumentHint: '', isSkill: false }
}

describe('buildSlashCommands', () => {
  it('tags global commands as isSkill when matching user/project skills', () => {
    const global = [cmd('context'), cmd('commit')]
    const userSkills = [cmd('context', 'user-level context skill')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    const context = result.find((c) => c.name === 'context')!
    expect(context.isSkill).toBe(true)
    // Non-matching global command stays non-skill
    const commit = result.find((c) => c.name === 'commit')!
    expect(commit.isSkill).toBe(false)
  })

  it('adds extra skills/commands not in globalSlashCommands', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('my-skill', 'custom skill')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    expect(result).toHaveLength(2)
    expect(result[1].name).toBe('my-skill')
  })

  it('deduplicates skills that exist in both user and project scope', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('tdd', 'user tdd')]
    const projectSkills = [cmd('tdd', 'project tdd')]
    const result = buildSlashCommands(global, userSkills, [], projectSkills, [])

    const tddEntries = result.filter((c) => c.name === 'tdd')
    expect(tddEntries).toHaveLength(1)
    // User skill takes priority (appears first in the merge)
    expect(tddEntries[0].description).toBe('user tdd')
  })

  it('deduplicates across all four extra sources', () => {
    const global: SlashCommandInfo[] = []
    const userSkills = [cmd('foo')]
    const userCommands = [cmd('foo')]
    const projectSkills = [cmd('foo')]
    const projectCommands = [cmd('foo')]
    const result = buildSlashCommands(global, userSkills, userCommands, projectSkills, projectCommands)

    expect(result.filter((c) => c.name === 'foo')).toHaveLength(1)
  })

  it('does not add extras that already exist in globalSlashCommands', () => {
    const global = [cmd('context')]
    const userSkills = [cmd('context', 'overridden')]
    const result = buildSlashCommands(global, userSkills, [], [], [])

    expect(result).toHaveLength(1)
    // Description comes from global, not from user skill
    expect(result[0].description).toBe('')
  })
})

describe('getCommandOutputMode', () => {
  it('returns popup for utility commands', () => {
    expect(getCommandOutputMode('help')).toBe('popup')
    expect(getCommandOutputMode('reset')).toBe('popup')
    expect(getCommandOutputMode('auth')).toBe('popup')
    expect(getCommandOutputMode('auth-status')).toBe('popup')
    expect(getCommandOutputMode('auth-set')).toBe('popup')
  })

  it('returns overlay for content commands', () => {
    expect(getCommandOutputMode('context')).toBe('overlay')
    expect(getCommandOutputMode('commit')).toBe('overlay')
    expect(getCommandOutputMode('review')).toBe('overlay')
  })

  it('defaults to overlay for unknown commands', () => {
    expect(getCommandOutputMode('unknown-command')).toBe('overlay')
  })
})
