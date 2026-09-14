/**
 * The delivery record's primitives against real SQLite
 * (`docs/design/session-sync-zone-delivery-record.md` §2, §3, §6).
 *
 * Every rule here is one the reviewer checked against the schema: the content
 * slot (P1), phase never moving on failure (P2), the compare-and-set on
 * `(id, phase, epoch)` and takeover on `(id, holder)` (R7, Q3), the tombstone
 * admission (P4), and the mirror's classification reading `outcome` before
 * `phase` (R4).
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import {
  abandonDelivery,
  advanceDelivery,
  classifyDeliveriesUnder,
  classifyDeliveryAt,
  completeDelivery,
  dropSessionDeliveries,
  ensureSessionFileDeliveriesSchema,
  findDeliveryByPath,
  getDelivery,
  listLiveDeliveries,
  recordDeliveryFailure,
  recordDeliveryOffset,
  reserveDelivery,
  retryGivenUpDeliveries,
  takeOverDelivery,
} from './db-session-deliveries'
import { _resetHoldersForTests, isHolderAlive, mintHolder, retireHolder } from './environment/delivery-holders'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  ensureSessionFileDeliveriesSchema(db)
  getDbMock.mockReturnValue(db)
  _resetHoldersForTests()
})

const base = { sessionId: 's1', connectionId: 'c1', relativePath: 'download/report.csv', origin: 'download' as const }
const P = '/zone/s1/download/report.csv'

function reserved(overrides: Partial<Parameters<typeof reserveDelivery>[0]> = {}) {
  const holder = mintHolder()
  const r = reserveDelivery({ ...base, localPath: P, holder, phase: 'writing', ...overrides })
  if (!('deliveryId' in r)) throw new Error(`reserve refused: ${r.refused}`)
  return { id: r.deliveryId, holder, epoch: r.epoch }
}

describe('reserving a delivery', () => {
  it('creates the row before any byte is written, held by the producer', () => {
    const { id, holder } = reserved()
    expect(getDelivery(id)).toMatchObject({ phase: 'writing', outcome: null, holder, epoch: 0, transferId: id })
  })

  it('refuses a path that already has any row, live or done (R2)', () => {
    const first = reserved()
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'path-taken' })
    // Even after that delivery is over: a new version is a new path.
    advanceDelivery(first.id, { from: 'writing', to: 'sealed', holder: first.holder, epoch: 0, total: 3, sha256: 'x' })
    abandonDelivery(first.id, { holder: first.holder, epoch: 1 })
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'path-taken' })
  })

  it('refuses a session that has been dropped, even after a restart', () => {
    dropSessionDeliveries('s1')
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'session-dropped' })
    // The tombstone is a row, not a Set: it is there after the process is not.
    expect(db.prepare('SELECT count(*) AS n FROM session_zone_tombstones').get()).toEqual({ n: 1 })
  })

  it('lets a produced file start sealed, with its size and hash fixed', () => {
    const r = reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'sealed', origin: 'produced', total: 11, sha256: 'abc' })
    expect('deliveryId' in r && getDelivery(r.deliveryId)).toMatchObject({ phase: 'sealed', total: 11, sha256: 'abc' })
  })

  it('keeps one content owner per path but lets a delivered row stand beside a new writer (P1)', () => {
    // Bypass R2 to test the index itself: the schema is the last line of defence.
    const t = reserved()
    db.prepare(`UPDATE session_file_deliveries SET phase = 'uploaded' WHERE delivery_id = ?`).run(t.id)
    const insert = (id: string, phase: string) =>
      db
        .prepare(
          `INSERT INTO session_file_deliveries (delivery_id, session_id, connection_id, local_path, relative_path, transfer_id, origin, phase, created_at, updated_at)
           VALUES (?, 's1', 'c1', ?, 'download/report.csv', ?, 'download', ?, 'now', 'now')`,
        )
        .run(id, P, id, phase)
    expect(() => insert('u', 'writing')).not.toThrow()
    expect(() => insert('v', 'writing')).toThrow(/UNIQUE/)
    expect(() => insert('w', 'sealed')).toThrow(/UNIQUE/)
  })
})

describe('advancing a delivery', () => {
  it('moves forward under the holder and epoch it was taken at, and bumps the epoch', () => {
    const { id, holder } = reserved()
    expect(advanceDelivery(id, { from: 'writing', to: 'sealed', holder, epoch: 0, total: 3, sha256: 'x' })).toEqual({ ok: true, epoch: 1 })
    expect(getDelivery(id)).toMatchObject({ phase: 'sealed', epoch: 1, total: 3, sha256: 'x' })
  })

  it('refuses a stale epoch, a wrong phase, and any step backwards', () => {
    const { id, holder } = reserved()
    advanceDelivery(id, { from: 'writing', to: 'sealed', holder, epoch: 0, total: 3, sha256: 'x' })
    expect(advanceDelivery(id, { from: 'writing', to: 'sealed', holder, epoch: 0, total: 3, sha256: 'x' })).toEqual({ ok: false })
    expect(advanceDelivery(id, { from: 'sealed', to: 'uploading', holder, epoch: 0 })).toEqual({ ok: false })
    expect(() => advanceDelivery(id, { from: 'sealed', to: 'writing', holder, epoch: 1 })).toThrow(/backwards/)
    expect(getDelivery(id)).toMatchObject({ phase: 'sealed', epoch: 1 })
  })

  it('lets a worker take a sealed file from its producer in one step', () => {
    const { id, holder } = reserved()
    advanceDelivery(id, { from: 'writing', to: 'sealed', holder, epoch: 0, total: 3, sha256: 'x' })
    const worker = mintHolder()
    expect(advanceDelivery(id, { from: 'sealed', to: 'uploading', holder: worker, epoch: 1 })).toEqual({ ok: true, epoch: 2 })
    expect(getDelivery(id)).toMatchObject({ holder: worker })
    // The producer's own later step is refused: it no longer holds the row.
    expect(abandonDelivery(id, { holder, epoch: 1 })).toBe(false)
  })

  it('records progress without changing the epoch, but not for a ghost', () => {
    const { id, holder } = reserved()
    advanceDelivery(id, { from: 'writing', to: 'sealed', holder, epoch: 0, total: 3, sha256: 'x' })
    advanceDelivery(id, { from: 'sealed', to: 'uploading', holder, epoch: 1 })
    expect(recordDeliveryOffset(id, { epoch: 2, offset: 2 })).toBe(true)
    expect(recordDeliveryOffset(id, { epoch: 1, offset: 3 })).toBe(false)
    expect(getDelivery(id)).toMatchObject({ offset: 2, epoch: 2 })
  })

  it('completes only from notifying, and a completed row keeps answering for its path', () => {
    const { id, holder } = reserved()
    let epoch = 0
    for (const [from, to] of [['writing', 'sealed'], ['sealed', 'uploading'], ['uploading', 'committing'], ['committing', 'uploaded'], ['uploaded', 'notifying']] as const) {
      const r = advanceDelivery(id, { from, to, holder, epoch, ...(to === 'sealed' ? { total: 3, sha256: 'x' } : {}) })
      expect(r.ok).toBe(true)
      epoch = (r as { epoch: number }).epoch
    }
    expect(completeDelivery(id, { holder, epoch })).toBe(true)
    expect(getDelivery(id)).toMatchObject({ outcome: 'done', phase: 'notifying', holder: null })
    expect(findDeliveryByPath('s1', P)?.deliveryId).toBe(id)
  })
})

describe('failure is scheduling, never phase (P2)', () => {
  it('backs off an uploaded row without touching its phase, and releases the holder', () => {
    const { id, holder } = reserved({ phase: 'sealed', origin: 'produced', total: 3, sha256: 'x' })
    advanceDelivery(id, { from: 'sealed', to: 'uploading', holder, epoch: 0 })
    advanceDelivery(id, { from: 'uploading', to: 'committing', holder, epoch: 1 })
    advanceDelivery(id, { from: 'committing', to: 'uploaded', holder, epoch: 2 })
    expect(recordDeliveryFailure(id, { epoch: 3, error: 'SQLITE_BUSY', nextAttemptAt: 1_000 })).toBe(true)
    expect(getDelivery(id)).toMatchObject({ phase: 'uploaded', holder: null, attempts: 1, lastError: 'SQLITE_BUSY', nextAttemptAt: 1_000, gaveUpAt: null })
  })

  it('lets a person retry what gave up — except a commit nobody can verify', () => {
    // Q3 of the third review: the generic Retry must never send the original
    // path again once the final put may already have landed.
    const stuck = reserved({ phase: 'sealed', origin: 'produced', total: 3, sha256: 'x' })
    advanceDelivery(stuck.id, { from: 'sealed', to: 'uploading', holder: stuck.holder, epoch: 0 })
    recordDeliveryFailure(stuck.id, { epoch: 1, error: 'node away', nextAttemptAt: null })
    const unverified = reserved({ localPath: '/zone/s1/download/other.csv', relativePath: 'download/other.csv', phase: 'sealed', origin: 'produced', total: 3, sha256: 'y' })
    advanceDelivery(unverified.id, { from: 'sealed', to: 'uploading', holder: unverified.holder, epoch: 0 })
    advanceDelivery(unverified.id, { from: 'uploading', to: 'committing', holder: unverified.holder, epoch: 1 })
    recordDeliveryFailure(unverified.id, { epoch: 2, error: 'commit unverified', nextAttemptAt: null })

    expect(retryGivenUpDeliveries('s1').sort()).toEqual([stuck.id])
    expect(getDelivery(stuck.id)).toMatchObject({ gaveUpAt: null, nextAttemptAt: null, attempts: 0 })
    expect(getDelivery(unverified.id)).toMatchObject({ phase: 'committing', gaveUpAt: expect.any(Number) })
  })

  it('gives up without touching the phase either', () => {
    const { id, holder } = reserved({ phase: 'sealed', origin: 'produced', total: 3, sha256: 'x' })
    advanceDelivery(id, { from: 'sealed', to: 'uploading', holder, epoch: 0 })
    advanceDelivery(id, { from: 'uploading', to: 'committing', holder, epoch: 1 })
    expect(recordDeliveryFailure(id, { epoch: 2, error: 'commit unverified', nextAttemptAt: null })).toBe(true)
    expect(getDelivery(id)).toMatchObject({ phase: 'committing', gaveUpAt: expect.any(Number), nextAttemptAt: null })
  })
})

describe('holders and takeover (Q3)', () => {
  it('knows its own live holders and nothing else', () => {
    const h = mintHolder()
    expect(isHolderAlive(h)).toBe(true)
    retireHolder(h)
    expect(isHolderAlive(h)).toBe(false)
    expect(isHolderAlive('previous-incarnation:abc')).toBe(false)
    expect(isHolderAlive(null)).toBe(false)
  })

  it('keeps a holder alive across its own phase advances until it retires', () => {
    // Q1 of the third review: `uploading → committing` is followed by an
    // awaited final put. The holder is still working; only the attempt's
    // real end takes it out of the live set.
    const { id, holder } = reserved({ phase: 'sealed', origin: 'produced', total: 3, sha256: 'x' })
    advanceDelivery(id, { from: 'sealed', to: 'uploading', holder, epoch: 0 })
    advanceDelivery(id, { from: 'uploading', to: 'committing', holder, epoch: 1 })
    expect(isHolderAlive(holder)).toBe(true)
    expect(takeOverDelivery(id, { deadHolder: holder, newHolder: mintHolder() })).toEqual({ ok: false })
    retireHolder(holder)
    expect(isHolderAlive(holder)).toBe(false)
    expect(takeOverDelivery(id, { deadHolder: holder, newHolder: mintHolder() })).toEqual({ ok: true, epoch: 3 })
  })

  it('takes over a dead holder in any phase and locks the ghost out', () => {
    const { id } = reserved()
    // A previous process held it through `notifying` and died.
    db.prepare(`UPDATE session_file_deliveries SET phase = 'notifying', holder = 'old:1' WHERE delivery_id = ?`).run(id)
    const me = mintHolder()
    expect(takeOverDelivery(id, { deadHolder: 'old:1', newHolder: me })).toEqual({ ok: true, epoch: 1 })
    expect(getDelivery(id)).toMatchObject({ holder: me, phase: 'notifying' })
    // The ghost's own next step, with the epoch it remembers, fails.
    expect(completeDelivery(id, { holder: 'old:1', epoch: 0 })).toBe(false)
    expect(takeOverDelivery(id, { deadHolder: 'old:1', newHolder: mintHolder() })).toEqual({ ok: false })
  })

  it('does not take over a holder that is merely busy', () => {
    const { id, holder } = reserved()
    expect(isHolderAlive(holder)).toBe(true)
    expect(takeOverDelivery(id, { deadHolder: 'someone-else', newHolder: mintHolder() })).toEqual({ ok: false })
    expect(getDelivery(id)).toMatchObject({ holder, epoch: 0 })
  })
})

describe('dropping a session (P4)', () => {
  it('abandons every live row, tombstones the session, and invalidates the holders', () => {
    const a = reserved()
    const b = reserved({ localPath: '/zone/s1/download/other.csv', relativePath: 'download/other.csv' })
    const other = reserved({ sessionId: 's2', localPath: '/zone/s2/x' })
    expect(dropSessionDeliveries('s1').sort()).toEqual([a.id, b.id].sort())
    expect(getDelivery(a.id)).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(getDelivery(other.id)).toMatchObject({ outcome: null })
    expect(advanceDelivery(a.id, { from: 'writing', to: 'sealed', holder: a.holder, epoch: 0, total: 1, sha256: 'x' })).toEqual({ ok: false })
    expect(dropSessionDeliveries('s1')).toEqual([])
  })
})

describe('what the mirror is told (R4)', () => {
  const at = (phase: string, outcome: string | null = null, path = P) => {
    const id = `d-${phase}-${outcome ?? 'live'}-${path.length}`
    db.prepare(
      `INSERT INTO session_file_deliveries (delivery_id, session_id, connection_id, local_path, relative_path, transfer_id, origin, phase, outcome, created_at, updated_at)
       VALUES (?, 's1', 'c1', ?, 'r', ?, 'download', ?, ?, 'now', 'now')`,
    ).run(id, path, id, phase, outcome)
  }

  it.each([
    ['writing', null, 'protected-unreadable'],
    ['sealed', null, 'protected-readable'],
    ['queued', null, 'protected-readable'],
    ['uploading', null, 'protected-readable'],
    ['committing', null, 'protected-unreadable'],
    ['uploaded', null, 'node-authoritative'],
    ['notifying', null, 'node-authoritative'],
    ['notifying', 'done', 'node-authoritative'],
    ['writing', 'abandoned', 'none'],
    ['sealed', 'abandoned', 'none'],
  ])('%s / %s → %s', (phase, outcome, expected) => {
    at(phase, outcome)
    expect(classifyDeliveryAt('s1', P)).toBe(expected)
  })

  it('answers none for a path with no row', () => {
    expect(classifyDeliveryAt('s1', P)).toBe('none')
  })

  it('answers unavailable — not none — when the table cannot be read (R5)', () => {
    getDbMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    expect(classifyDeliveryAt('s1', P)).toBe('unavailable')
    expect(classifyDeliveriesUnder('s1', '/zone/s1/download')).toBe('unavailable')
  })

  it('protects a directory by its most protected member, ignoring abandoned ones', () => {
    at('uploaded', null, '/zone/s1/download/a')
    expect(classifyDeliveriesUnder('s1', '/zone/s1/download')).toBe('none')
    at('sealed', null, '/zone/s1/download/b')
    expect(classifyDeliveriesUnder('s1', '/zone/s1/download')).toBe('protected-readable')
    at('writing', 'abandoned', '/zone/s1/download/c')
    expect(classifyDeliveriesUnder('s1', '/zone/s1/download')).toBe('protected-readable')
    at('writing', null, '/zone/s1/download/nested/d')
    expect(classifyDeliveriesUnder('s1', '/zone/s1/download')).toBe('protected-unreadable')
    // A sibling directory with a similar prefix is not under it.
    expect(classifyDeliveriesUnder('s1', '/zone/s1/down')).toBe('none')
  })
})

describe('what the worker is handed', () => {
  it('lists every live row of the connection that is due and has not given up', () => {
    const due = reserved()
    const later = reserved({ localPath: '/zone/s1/later', relativePath: 'later' })
    recordDeliveryFailure(later.id, { epoch: 0, error: 'x', nextAttemptAt: 5_000 })
    const gaveUp = reserved({ localPath: '/zone/s1/gave-up', relativePath: 'gave-up' })
    recordDeliveryFailure(gaveUp.id, { epoch: 0, error: 'x', nextAttemptAt: null })
    reserved({ connectionId: 'c2', localPath: '/zone/s1/elsewhere', relativePath: 'elsewhere' })
    const dropped = reserved({ sessionId: 's9', localPath: '/zone/s9/x', relativePath: 'x' })
    dropSessionDeliveries('s9')
    expect(listLiveDeliveries('c1', 1_000).map((d) => d.deliveryId)).toEqual([due.id])
    expect(listLiveDeliveries('c1', 5_000).map((d) => d.deliveryId).sort()).toEqual([due.id, later.id].sort())
    expect(getDelivery(dropped.id)?.outcome).toBe('abandoned')
  })
})
