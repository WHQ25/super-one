import { describe, expect, it } from 'vitest'
import type { SlashCommandInfo } from './agent-types'
import { matchAndRankSlashCommands } from './slash-command-match'

function skill(description: string, argumentHint = ''): SlashCommandInfo {
  return { name: 'skill-creator', description, argumentHint, isSkill: true }
}

describe('slash catalog duplicates', () => {
  it.each(['', 's', 'skill-c'])('collapses identical names and descriptions for query %j', (query) => {
    const first = skill('Create new skills', '<target>')
    const result = matchAndRankSlashCommands(query, [first, skill('Create new skills')])

    expect(result).toHaveLength(1)
    expect(result[0].argumentHint).toBe('<target>')
    expect(result[0].matchIndices).toEqual(Array.from({ length: query.length }, (_, i) => i))
  })

  it('preserves same-named skills with different descriptions', () => {
    const result = matchAndRankSlashCommands('skill-c', [skill('Create new skills'), skill('Create a Codex skill')])

    expect(result.map((item) => item.description)).toEqual(['Create new skills', 'Create a Codex skill'])
  })

  it('preserves a command and skill with the same name and description', () => {
    const entry = skill('Create new skills')
    const result = matchAndRankSlashCommands('', [{ ...entry, isSkill: false }, entry])

    expect(result.map((item) => item.isSkill)).toEqual([false, true])
  })

  it('keeps identities distinct when names and descriptions contain separators', () => {
    const result = matchAndRankSlashCommands('', [
      { ...skill('c'), name: 'a:b' },
      { ...skill('b:c'), name: 'a' },
    ])

    expect(result).toHaveLength(2)
  })
})
