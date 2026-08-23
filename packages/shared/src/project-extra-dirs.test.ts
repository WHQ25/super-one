import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECT_EXTRA_DIRS,
  normalizeProjectExtraDirs,
  parseProjectExtraDirs,
} from './project-extra-dirs'

describe('reading persisted project workspace folders', () => {
  it('returns the stored list for a well-formed column', () => {
    expect(parseProjectExtraDirs('["/a","/b"]')).toEqual(['/a', '/b'])
  })

  it('reads an empty list when the column is null, blank or not yet migrated', () => {
    expect(parseProjectExtraDirs(null)).toEqual([])
    expect(parseProjectExtraDirs(undefined)).toEqual([])
    expect(parseProjectExtraDirs('')).toEqual([])
  })

  it('degrades to an empty list instead of throwing when the column holds garbage', () => {
    expect(parseProjectExtraDirs('not json')).toEqual([])
    expect(parseProjectExtraDirs('{"not":"an array"}')).toEqual([])
  })

  it('drops non-string and blank entries a hand-edited database might contain', () => {
    expect(parseProjectExtraDirs('["/a", 42, null, "  ", "/b"]')).toEqual(['/a', '/b'])
  })
})

describe('normalizing workspace folders before they are persisted', () => {
  it('resolves relative input to absolute paths', () => {
    const [dir] = normalizeProjectExtraDirs(['./sibling'], '/repo')
    expect(dir.startsWith('/')).toBe(true)
    expect(dir.endsWith('/sibling')).toBe(true)
  })

  it('drops the project root so the composer hint never shows a duplicate chip', () => {
    expect(normalizeProjectExtraDirs(['/repo', '/other'], '/repo')).toEqual(['/other'])
  })

  it('drops the project root even when it arrives with a trailing separator', () => {
    expect(normalizeProjectExtraDirs(['/repo/', '/other'], '/repo')).toEqual(['/other'])
  })

  it('dedupes folders that differ only by trailing separator or blank padding', () => {
    expect(normalizeProjectExtraDirs([' /a ', '/a/', '/a'], '/repo')).toEqual(['/a'])
  })

  it('keeps a sibling package inside the same git repo — the monorepo case this feature exists for', () => {
    expect(normalizeProjectExtraDirs(['/repo/packages/ui'], '/repo/apps/desktop')).toEqual([
      '/repo/packages/ui',
    ])
  })

  it('does not require folders to exist, so an unmounted volume survives an unrelated rename', () => {
    expect(normalizeProjectExtraDirs(['/Volumes/detached/code'], '/repo')).toEqual([
      '/Volumes/detached/code',
    ])
  })

  it('caps the list so a project cannot crowd out the config and session scopes', () => {
    const many = Array.from({ length: MAX_PROJECT_EXTRA_DIRS + 5 }, (_, i) => `/dir-${i}`)
    expect(normalizeProjectExtraDirs(many, '/repo')).toHaveLength(MAX_PROJECT_EXTRA_DIRS)
  })
})
