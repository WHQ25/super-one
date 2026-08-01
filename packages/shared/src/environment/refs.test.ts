import { describe, expect, it } from 'vitest'
import {
  assertSameEnvironment,
  parseProjectKey,
  parseSessionKey,
  projectKey,
  projectRef,
  sessionKey,
  sessionRef,
  terminalKey,
  terminalRef,
} from './refs'

describe('scoped refs', () => {
  it('builds and keys project/session/terminal refs', () => {
    const p = projectRef('env-a', 'proj-1')
    const s = sessionRef('env-a', 'sess-1')
    const t = terminalRef('env-a', 'term-1')
    expect(projectKey(p)).toBe('env-a:proj-1')
    expect(sessionKey(s)).toBe('env-a:sess-1')
    expect(terminalKey(t)).toBe('env-a:term-1')
  })

  it('parses keys back to refs', () => {
    expect(parseProjectKey('env-a:proj-1')).toEqual({ environmentId: 'env-a', projectId: 'proj-1' })
    expect(parseSessionKey('env-a:sess-1')).toEqual({ environmentId: 'env-a', sessionId: 'sess-1' })
  })

  it('rejects malformed keys', () => {
    expect(parseProjectKey('')).toBeNull()
    expect(parseProjectKey('nocolon')).toBeNull()
    expect(parseProjectKey(':only-id')).toBeNull()
    expect(parseProjectKey('env:')).toBeNull()
    expect(parseSessionKey('env:')).toBeNull()
  })

  it('allows colons inside the id portion', () => {
    expect(parseProjectKey('env:path:/tmp/foo')).toEqual({
      environmentId: 'env',
      projectId: 'path:/tmp/foo',
    })
  })

  it('detects environment mismatch', () => {
    expect(assertSameEnvironment({ environmentId: 'a' }, { environmentId: 'a' })).toBeNull()
    expect(assertSameEnvironment({ environmentId: 'a' }, { environmentId: 'b' }, 'session')).toContain(
      'session environment mismatch',
    )
  })
})
