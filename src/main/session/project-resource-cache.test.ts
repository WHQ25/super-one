import { describe, expect, it, vi } from 'vitest'
import { ProjectResourceCache, type DiscoverFns } from './project-resource-cache'

function makeDiscover(): DiscoverFns {
  return {
    discoverSkills: vi.fn((cwd: string) => [{ name: `skill@${cwd}`, description: 'd', argumentHint: '', isSkill: true }]),
    discoverProjectCommands: vi.fn((cwd: string) => [{ name: `cmd@${cwd}`, description: '', argumentHint: '', isSkill: false }]),
    discoverProjectAgents: vi.fn((cwd: string) => [{ name: `agent@${cwd}`, description: '', source: 'project' as const }]),
    discoverAdditionalDirectories: vi.fn((cwd: string) => [`${cwd}/extra-1`, `${cwd}/extra-2`]),
  }
}

describe('ProjectResourceCache', () => {
  it('keys cache by cwd, not by some derived path', () => {
    const discover = makeDiscover()
    const cache = new ProjectResourceCache(discover)

    const a = cache.get('/proj')
    const b = cache.get('/proj/.worktrees/wt-1')

    expect(a).not.toBe(b)
    expect(a.cwd).toBe('/proj')
    expect(b.cwd).toBe('/proj/.worktrees/wt-1')
    expect(a.skills[0].name).toBe('skill@/proj')
    expect(b.skills[0].name).toBe('skill@/proj/.worktrees/wt-1')
  })

  it('returns the same object for repeated lookups (caches result)', () => {
    const cache = new ProjectResourceCache(makeDiscover())
    const a = cache.get('/proj')
    const b = cache.get('/proj')
    expect(a).toBe(b)
  })

  it('does not call discover functions on cache hit', () => {
    const discover = makeDiscover()
    const cache = new ProjectResourceCache(discover)
    cache.get('/proj')
    cache.get('/proj')
    cache.get('/proj')
    expect(discover.discoverSkills).toHaveBeenCalledTimes(1)
    expect(discover.discoverAdditionalDirectories).toHaveBeenCalledTimes(1)
  })

  it('invalidate(cwd) drops only that cwd entry', () => {
    const cache = new ProjectResourceCache(makeDiscover())
    const a = cache.get('/a')
    const b = cache.get('/b')
    cache.invalidate('/a')
    const a2 = cache.get('/a')
    const b2 = cache.get('/b')
    expect(a2).not.toBe(a)
    expect(b2).toBe(b)
  })

  it('clear() drops everything', () => {
    const cache = new ProjectResourceCache(makeDiscover())
    const a = cache.get('/a')
    const b = cache.get('/b')
    cache.clear()
    expect(cache.get('/a')).not.toBe(a)
    expect(cache.get('/b')).not.toBe(b)
  })

  it('includes additionalDirectories in returned ProjectResources', () => {
    const cache = new ProjectResourceCache(makeDiscover())
    const r = cache.get('/proj')
    expect(r.additionalDirectories).toEqual(['/proj/extra-1', '/proj/extra-2'])
  })

  it('passes cwd verbatim to all discover functions', () => {
    const discover = makeDiscover()
    const cache = new ProjectResourceCache(discover)
    cache.get('/exact/cwd-string')
    expect(discover.discoverSkills).toHaveBeenCalledWith('/exact/cwd-string')
    expect(discover.discoverProjectCommands).toHaveBeenCalledWith('/exact/cwd-string')
    expect(discover.discoverProjectAgents).toHaveBeenCalledWith('/exact/cwd-string')
    expect(discover.discoverAdditionalDirectories).toHaveBeenCalledWith('/exact/cwd-string')
  })
})
