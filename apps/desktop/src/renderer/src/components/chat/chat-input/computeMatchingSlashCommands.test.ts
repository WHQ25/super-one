import { describe, it, expect } from 'vitest'
import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { computeMatchingSlashCommands } from './computeMatchingSlashCommands'

function cmd(name: string, isSkill: boolean, description = ''): SlashCommandInfo {
  return { name, description, argumentHint: '', isSkill }
}

describe('slash command match ranking', () => {
  it('ranks an exact-match skill above a weaker-matching command', () => {
    const commands = [cmd('code-review', false), cmd('review', true)]
    const result = computeMatchingSlashCommands('/review', commands, 'claude')
    expect(result.map((c) => c.name)).toEqual(['review', 'code-review'])
  })

  it('keeps commands before skills when the query is empty (just "/")', () => {
    const commands = [cmd('skill', true), cmd('command', false)]
    const result = computeMatchingSlashCommands('/', commands, 'claude')
    expect(result.map((c) => c.name)).toEqual(['command', 'skill'])
  })

  it('uses isSkill only as a tiebreaker among equally scored matches', () => {
    const commands = [cmd('review', true), cmd('review', false)]
    const result = computeMatchingSlashCommands('/review', commands, 'claude')
    expect(result.map((c) => c.isSkill)).toEqual([false, true])
  })

  it('applies the same ranking on the codex path', () => {
    const commands = [cmd('code-review', false), cmd('review', true)]
    const result = computeMatchingSlashCommands('/review', commands, 'codex')
    expect(result.map((c) => c.name)).toEqual(['review', 'code-review'])
  })
})
