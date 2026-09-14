import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', dropped: [] as string[] }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => ({ artifactTransfers: { dropSession: (id: string) => state.dropped.push(id) } }),
}))

import { ADHOC_MAX_AGE_MS, markZoneOwner, reclaimSyncZone, removeSessionZone } from './session-zone-reclaim'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zone-reclaim-'))
  state.userData = root
  state.dropped = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('session zone reclaim', () => {
  it('removes the session directory and cancels its transfer jobs', async () => {
    const dir = join(root, 'sync', 's1', 'browser')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.png'), 'x')
    await removeSessionZone('s1')
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    expect(state.dropped).toEqual(['s1'])
  })

  it('never touches the adhoc zone or an empty id', async () => {
    const adhoc = join(root, 'sync', 'adhoc')
    mkdirSync(adhoc, { recursive: true })
    writeFileSync(join(adhoc, 'manual.png'), 'x')
    await removeSessionZone('adhoc')
    await removeSessionZone('')
    expect(existsSync(adhoc)).toBe(true)
    expect(state.dropped).toEqual([])
  })
})

describe('sync zone sweep', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = 1_800_000_000_000

  function zoneFile(sessionId: string, rel: string, ageMs = 0): string {
    const path = join(root, 'sync', sessionId, ...rel.split('/'))
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'bytes')
    const seconds = (now - ageMs) / 1000
    utimesSync(path, seconds, seconds)
    utimesSync(join(root, 'sync', sessionId), seconds, seconds)
    return path
  }

  function deps(overrides: Partial<Parameters<typeof reclaimSyncZone>[0]> = {}) {
    return {
      now: () => now,
      hasLocalSession: () => false,
      hasPendingTransfer: () => false,
      remoteSessionExists: async () => 'unknown' as const,
      ...overrides,
    }
  }

  it('reclaims a local session directory the database no longer knows', async () => {
    zoneFile('gone', 'browser/a.png', 2 * DAY)
    markZoneOwner('gone', null)
    zoneFile('live', 'browser/b.png', 2 * DAY)
    markZoneOwner('live', null)
    const result = await reclaimSyncZone(deps({ hasLocalSession: (id) => id === 'live' }))
    expect(result.removed).toEqual(['gone'])
    expect(existsSync(join(root, 'sync', 'gone'))).toBe(false)
    expect(existsSync(join(root, 'sync', 'live'))).toBe(true)
  })

  it('keeps a remote session the node still has, and reclaims one it does not', async () => {
    zoneFile('remote-live', 'agent/a.md', 2 * DAY)
    markZoneOwner('remote-live', 'conn-1')
    zoneFile('remote-gone', 'agent/b.md', 2 * DAY)
    markZoneOwner('remote-gone', 'conn-1')
    const result = await reclaimSyncZone(deps({
      remoteSessionExists: async (_c, id) => id === 'remote-live',
    }))
    expect(result.removed).toEqual(['remote-gone'])
  })

  it('keeps a remote session whose node cannot be reached, rather than guessing', async () => {
    zoneFile('offline', 'agent/a.md', 30 * DAY)
    markZoneOwner('offline', 'conn-1')
    const result = await reclaimSyncZone(deps())
    expect(result.removed).toEqual([])
  })

  it('keeps an unmarked directory however old it is, and never asks a node about it', async () => {
    // Ownership has only been recorded since this version. An unmarked
    // directory may belong to a live *remote* session, which has no row in
    // this database — so neither the database nor silence is evidence, and
    // there is nobody to ask. Age is a TTL, not a proof of death, and this
    // sweep only deletes what it can prove.
    zoneFile('old-unmarked', 'browser/a.png', 400 * DAY)
    zoneFile('recent-unmarked', 'browser/b.png', DAY)
    let asked = 0
    const result = await reclaimSyncZone(deps({ remoteSessionExists: async () => { asked++; return false } }))
    expect(result.removed).toEqual([])
    expect(asked).toBe(0)
  })

  it('never reclaims a directory with a transfer still queued', async () => {
    zoneFile('pending', 'recording/a.mp4', 30 * DAY)
    markZoneOwner('pending', null)
    const result = await reclaimSyncZone(deps({ hasPendingTransfer: (id) => id === 'pending' }))
    expect(result.removed).toEqual([])
  })

  it('prunes stale adhoc captures without ever removing the adhoc directory itself', async () => {
    const old = zoneFile('adhoc', 'browser/old.png', ADHOC_MAX_AGE_MS + DAY)
    const fresh = zoneFile('adhoc', 'browser/fresh.png', DAY)
    const result = await reclaimSyncZone(deps())
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(join(root, 'sync', 'adhoc'))).toBe(true)
    expect(result.freedBytes).toBeGreaterThan(0)
  })

  it('never follows a symlink out of the zone, at the top level or inside it', async () => {
    // The sweep deletes files; a link is the one way it could delete something
    // that is not ours. `statSync` follows links, so the scan uses `lstat`.
    const outside = mkdtempSync(join(tmpdir(), 'not-the-zone-'))
    try {
      const victim = join(outside, 'precious.txt')
      writeFileSync(victim, 'not ours')
      const ancient = (now - 30 * DAY) / 1000
      utimesSync(victim, ancient, ancient)

      mkdirSync(join(root, 'sync', 'adhoc', 'browser'), { recursive: true })
      symlinkSync(outside, join(root, 'sync', 'adhoc', 'browser', 'alias'))
      symlinkSync(outside, join(root, 'sync', 'linked-session'))

      const result = await reclaimSyncZone(deps())
      expect(existsSync(victim)).toBe(true)
      expect(result.removed).toEqual([])
      // The link itself may go; what is on the other side may not.
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('keeps an unmarked directory whose session this desktop still has, however old it is', async () => {
    // Ownership was only recorded from this version on; silence is not proof
    // of death when the database still names the session.
    zoneFile('old-but-live', 'browser/a.png', 400 * DAY)
    const result = await reclaimSyncZone(deps({ hasLocalSession: (id) => id === 'old-but-live' }))
    expect(result.removed).toEqual([])
  })

  it('does nothing at all when there is no zone yet', async () => {
    expect(await reclaimSyncZone(deps())).toEqual({ removed: [], freedBytes: 0 })
  })
})
