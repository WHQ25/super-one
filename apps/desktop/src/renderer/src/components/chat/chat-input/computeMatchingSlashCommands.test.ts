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

  it('puts the whole best-scoring group ahead of the other group', () => {
    const commands = [cmd('code-review', false), cmd('review', true), cmd('reviewer', true)]
    const result = computeMatchingSlashCommands('/review', commands, 'claude')
    // skills hold the exact match, so the entire skill group is contiguous and first
    expect(result.map((c) => c.isSkill)).toEqual([true, true, false])
    expect(result[result.length - 1].name).toBe('code-review')
  })

  it('excludes items that match only on description, never on name', () => {
    const commands = [cmd('deploy', false, 'review the pending changes'), cmd('review', true)]
    const result = computeMatchingSlashCommands('/review', commands, 'claude')
    expect(result.map((c) => c.name)).toEqual(['review'])
  })

  it('every returned item carries name match indices (visible highlight)', () => {
    const commands = [cmd('deploy', false, 'review the pending changes'), cmd('review', true)]
    const result = computeMatchingSlashCommands('/rev', commands, 'claude')
    for (const c of result) expect(c.matchIndices.length).toBeGreaterThan(0)
  })

  it('applies the same ranking on the codex path', () => {
    const commands = [cmd('code-review', false), cmd('review', true)]
    const result = computeMatchingSlashCommands('/review', commands, 'codex')
    expect(result.map((c) => c.name)).toEqual(['review', 'code-review'])
  })

  it('matches only the first line, ignoring later lines of a multi-line message', () => {
    const commands = [cmd('review', true)]
    const result = computeMatchingSlashCommands('/review\nsome more context here', commands, 'claude')
    expect(result.map((c) => c.name)).toEqual(['review'])
  })

  it('bails on a space in the command line even when it is not the last line', () => {
    const commands = [cmd('review', true)]
    const result = computeMatchingSlashCommands('/rev iew\nnext line', commands, 'claude')
    expect(result).toEqual([])
  })
})
