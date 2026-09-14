import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userData: '',
  dropped: [] as string[],
  localSessions: new Set<string>(),
}))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('./environment-host', () => ({
  getEnvironmentHost: () => ({
    artifactTransfers: { dropSession: (id: string) => state.dropped.push(id) },
    getSession: async () => null,
  }),
}))
vi.mock('../db-sessions', () => ({ sessionExists: (id: string) => state.localSessions.has(id) }))

import { ADHOC_MAX_AGE_MS, createReclaimScheduler, markZoneOwner, reclaimSyncZone, sweepSyncZone, removeSessionZone, syncZoneUsage } from './session-zone-reclaim'
import { reserveDelivery, type DeliveryPhase } from '../db-session-deliveries'
import { deliveryDb, resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests, mintHolder } from './delivery-holders'

/**
 * A delivery-record row for a file already written to disk, in the state the
 * scenario names. A `sealed` (or `uploading`) row is a desktop original the
 * node still owes; `gaveUp` is one automatic retry has stopped on.
 */
function deliver(sessionId: string, rel: string, opts: { phase?: DeliveryPhase; gaveUp?: boolean; error?: string } = {}): void {
  const localPath = join(root, 'sync', sessionId, ...rel.split('/'))
  const r = reserveDelivery({ sessionId, connectionId: 'conn-1', localPath, relativePath: rel, origin: 'produced', phase: 'writing', holder: mintHolder() })
  if ('refused' in r) throw new Error(r.refused)
  deliveryDb()
    .prepare('UPDATE session_file_deliveries SET phase = ?, holder = NULL, gave_up_at = ?, last_error = ? WHERE delivery_id = ?')
    .run(opts.phase ?? 'sealed', opts.gaveUp ? new Date().toISOString() : null, opts.error ?? null, r.deliveryId)
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zone-reclaim-'))
  state.userData = root
  state.dropped = []
  state.localSessions = new Set()
  resetDeliveryDatabase()
  _resetHoldersForTests()
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

  it('reclaims a dead session whose only remaining job has failed for good, and drops that job with it', async () => {
    // `failed` is terminal — no retry is scheduled — so it is not "an upload
    // still queued". Treating it as one pinned a dead directory forever.
    // The startup sweep reads the real clock, so these ages are real too.
    const aged = (sessionId: string, rel: string) => {
      const path = zoneFile(sessionId, rel)
      markZoneOwner(sessionId, null)
      const seconds = (Date.now() - 2 * DAY) / 1000
      for (const p of [path, join(path, '..'), join(root, 'sync', sessionId, '.owner'), join(root, 'sync', sessionId)]) utimesSync(p, seconds, seconds)
    }
    aged('dead', 'recording/a.mp4')
    // Its one delivery gave up: no retry is scheduled, so it does not pin the dir.
    deliver('dead', 'recording/a.mp4', { phase: 'uploading', gaveUp: true })
    const result = await sweepSyncZone()
    expect(result.removed).toEqual(['dead'])
    expect(state.dropped).toEqual(['dead'])
    aged('retrying', 'recording/b.mp4')
    // A live delivery still to be sent keeps the directory.
    deliver('retrying', 'recording/b.mp4', { phase: 'sealed' })
    expect((await sweepSyncZone()).removed).toEqual([])
  })

  it('reports a dead directory once when a manual sweep lands during the scheduled one', async () => {
    // Asking the node is an await, and two walks park on it for the same
    // directory. The post-await re-check is what keeps the second from sizing
    // and reporting a directory the first already removed.
    const sessionId = 'dead'
    const path = join(root, 'sync', sessionId, 'recording', 'a.mp4')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'xxxxxxxx')
    markZoneOwner(sessionId, 'conn-1')
    const seconds = (Date.now() - 2 * DAY) / 1000
    for (const p of [path, join(path, '..'), join(root, 'sync', sessionId, '.owner'), join(root, 'sync', sessionId)]) utimesSync(p, seconds, seconds)
    const [scheduled, manual] = await Promise.all([sweepSyncZone(), sweepSyncZone()])
    expect(scheduled.freedBytes + manual.freedBytes).toBe(8 + 'conn-1'.length)
    expect([...scheduled.removed, ...manual.removed]).toEqual([sessionId])
  })

  it('does nothing at all when there is no zone yet', async () => {
    expect(await reclaimSyncZone(deps())).toEqual({ removed: [], freedBytes: 0 })
  })
})

describe('reclaim scheduling', () => {
  it('collapses a burst of requests into one sweep, and runs once more for a request made mid-sweep', async () => {
    // A node that reconnects raises several status changes in a row; a
    // sweep already asking that node must not be joined by a second one, but
    // a request that arrived while it ran may have new evidence and gets its
    // own pass afterwards.
    vi.useFakeTimers()
    try {
      let running = 0
      let peak = 0
      const runs: number[] = []
      let release: () => void = () => {}
      const run = vi.fn(async () => {
        running++
        peak = Math.max(peak, running)
        runs.push(Date.now())
        await new Promise<void>((resolve) => { release = resolve })
        running--
      })
      const scheduler = createReclaimScheduler(run, { debounceMs: 1000 })
      scheduler.request()
      scheduler.request()
      scheduler.request()
      await vi.advanceTimersByTimeAsync(999)
      expect(run).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(1)

      scheduler.request()
      await vi.advanceTimersByTimeAsync(5000)
      expect(run).toHaveBeenCalledTimes(1)
      release()
      await vi.advanceTimersByTimeAsync(1000)
      expect(run).toHaveBeenCalledTimes(2)
      expect(peak).toBe(1)
      release()
      await vi.advanceTimersByTimeAsync(0)

      scheduler.dispose()
      scheduler.request()
      await vi.advanceTimersByTimeAsync(5000)
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sync zone usage', () => {
  it('reports what the zone holds, what is still to be uploaded, and what a sweep would free — without freeing it', async () => {
    // Settings shows this so a person can decide; the sweep must not run as
    // a side effect of looking.
    const DAY = 24 * 60 * 60 * 1000
    const aged = (sessionId: string, rel: string, ageMs: number, bytes: string) => {
      const path = join(root, 'sync', sessionId, ...rel.split('/'))
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, bytes)
      markZoneOwner(sessionId, null)
      const seconds = (Date.now() - ageMs) / 1000
      for (const p of [path, join(path, '..'), join(root, 'sync', sessionId, '.owner'), join(root, 'sync', sessionId)]) utimesSync(p, seconds, seconds)
    }
    aged('dead', 'browser/a.png', 2 * DAY, 'xxxx')
    aged('live', 'browser/b.png', 2 * DAY, 'yyyyyy')
    // Already on the node, only the agent's wake still owed: not "to be uploaded".
    aged('live', 'browser/c.png', 2 * DAY, 'zzz')
    state.localSessions = new Set(['live'])
    // b is a desktop original still owed to the node; c is already there,
    // only the agent's wake outstanding — not counted as "to be uploaded".
    deliver('live', 'browser/b.png', { phase: 'sealed' })
    deliver('live', 'browser/c.png', { phase: 'notifying' })
    mkdirSync(join(root, 'sync', 'adhoc', 'browser'), { recursive: true })
    writeFileSync(join(root, 'sync', 'adhoc', 'browser', 'manual.png'), 'zz')

    const usage = await syncZoneUsage()
    expect(usage).toMatchObject({
      sessionCount: 2,
      adhocBytes: 2,
      pendingBytes: 6,
      // The dead directory's 4 bytes plus its 5-byte `.owner` marker.
      reclaimable: { sessions: 1, bytes: 4 + 'local'.length },
    })
    expect(usage.totalBytes).toBeGreaterThanOrEqual(15)
    expect(usage.root).toBe(join(root, 'sync'))
    expect(existsSync(join(root, 'sync', 'dead'))).toBe(true)
  })
})
