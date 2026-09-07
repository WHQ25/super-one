import { describe, expect, it } from 'vitest'
import { filterSlashCommands, mergeSlashCatalogs } from './slash'

const CATALOG = mergeSlashCatalogs(
  [
    { name: 'help', description: 'Show help' },
    { name: 'compact', description: 'Compact context' },
    { name: 'debug' },
    { name: 'review', description: 'Review diffs' },
    { name: 'auth auto', description: 'Codex auth' },
  ],
  [],
  [{ name: 'release', description: 'Ship it' }],
)

const names = (text: string, provider?: string) =>
  filterSlashCommands(text, CATALOG, provider).map((m) => m.name)

describe('filterSlashCommands', () => {
  it('requires a leading slash and hides terminal-only commands', () => {
    expect(names('help')).toEqual([])
    expect(names('/')).toEqual(['help', 'compact', 'review', 'auth auto', 'release'])
  })

  it('matches the first line only, so a command can carry context under it', () => {
    // The whole draft used to be the query, which closed the overlay the moment
    // the user pressed return.
    expect(names('/help\nplease explain the flags')).toEqual(['help'])
    expect(names('/help extra')).toEqual([])
  })

  it('leads with the group holding the best match', () => {
    // `release` is a skill and matches from index 0; `review` is a command and
    // does not. The better-scoring group comes first.
    expect(names('/rel')).toEqual(['release'])
    expect(names('/re')[0]).toBe('review')
  })

  it('fuzzy-ranks prefix hits above later subsequence hits', () => {
    expect(names('/c')[0]).toBe('compact')
  })

  it('lets Codex keep its spaces and its hidden commands', () => {
    expect(names('/auth au', 'codex')).toEqual(['auth auto'])
    expect(names('/auth au')).toEqual([])
    expect(names('/debug', 'codex')).toEqual(['debug'])
    expect(names('/debug')).toEqual([])
  })

  it('merges system, project, and skill catalogs without duplicate names', () => {
    expect(mergeSlashCatalogs(
      [{ name: 'review', description: 'System review' }],
      [{ name: 'review', description: 'Project review' }, { name: 'test' }],
      [{ name: 'ship', description: 'Release it' }],
    )).toEqual([
      { name: 'review', description: 'Project review', argumentHint: '', isSkill: false },
      { name: 'test', description: '', argumentHint: '', isSkill: false },
      { name: 'ship', description: 'Release it', argumentHint: '', isSkill: true },
    ])
  })
})
