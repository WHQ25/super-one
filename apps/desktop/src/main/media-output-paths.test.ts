import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/userData' } }))

import {
  ADHOC_SESSION_ID,
  assertZoneSessionId,
  isUnderSyncZone,
  producerDir,
  sessionZoneDir,
  syncZoneRoot,
  zoneRelativePath,
} from './media-output-paths'

describe('sync zone layout', () => {
  it('lays a session out as <userData>/sync/<sessionId>/<producer>', () => {
    expect(syncZoneRoot()).toBe('/userData/sync')
    expect(sessionZoneDir('s1')).toBe('/userData/sync/s1')
    expect(producerDir('s1', 'browser')).toBe('/userData/sync/s1/browser')
    expect(producerDir('s1', 'media-gen')).toBe('/userData/sync/s1/media-gen')
  })

  it('files captures taken with no session under the reserved adhoc id', () => {
    expect(sessionZoneDir()).toBe(`/userData/sync/${ADHOC_SESSION_ID}`)
    expect(producerDir('', 'computer-use')).toBe(`/userData/sync/${ADHOC_SESSION_ID}/computer-use`)
  })

  it('refuses a session id that is not a single path component', () => {
    for (const bad of ['..', 'a/b', 'a\\b', '.hidden', '']) {
      expect(() => assertZoneSessionId(bad), bad).toThrow(/invalid sync zone session id/)
    }
    expect(assertZoneSessionId('2f1c6e0a-1b2c-4d3e-8f9a-0b1c2d3e4f5a')).toBe('2f1c6e0a-1b2c-4d3e-8f9a-0b1c2d3e4f5a')
  })

  it('splits a zone path into its session and producer-relative part', () => {
    expect(zoneRelativePath('/userData/sync/s1/browser/shot.png')).toEqual({ sessionId: 's1', relativePath: 'browser/shot.png' })
    expect(zoneRelativePath('/userData/sync/s1')).toBeNull()
    expect(zoneRelativePath('/userData/sync')).toBeNull()
    expect(zoneRelativePath('/userData/synced/s1/browser/shot.png')).toBeNull()
    expect(zoneRelativePath('/userData/sync/s1/../../media-gen/keys.bin')).toBeNull()
  })

  it('answers isUnderSyncZone textually so a not-yet-written path still counts', () => {
    expect(isUnderSyncZone('/userData/sync/s1/agent/report.md')).toBe(true)
    expect(isUnderSyncZone('/userData/sync')).toBe(false)
    expect(isUnderSyncZone('/userData/media-gen/keys.bin')).toBe(false)
  })
})
