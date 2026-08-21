import { describe, expect, it } from 'vitest'
import { filterSlashCommands, fuzzyMatch } from './slash'

const RAW = [
  { name: 'help', description: 'Show help' },
  { name: 'compact', description: 'Compact context' },
  { name: 'debug' },
  { name: 'review', description: 'Review diffs' },
]

describe('filterSlashCommands', () => {
  it('hides debug and requires a leading slash without spaces', () => {
    expect(filterSlashCommands('help', RAW).map((m) => m.command.name)).toEqual([])
    expect(filterSlashCommands('/help extra', RAW)).toEqual([])
    expect(filterSlashCommands('/', RAW).map((m) => m.command.name)).toEqual(['help', 'compact', 'review'])
  })

  it('fuzzy-ranks prefix hits above later subsequence hits', () => {
    const names = filterSlashCommands('/c', RAW).map((m) => m.command.name)
    expect(names[0]).toBe('compact')
    expect(fuzzyMatch('hlp', 'help').match).toBe(true)
    expect(fuzzyMatch('zzz', 'help').match).toBe(false)
  })
})
