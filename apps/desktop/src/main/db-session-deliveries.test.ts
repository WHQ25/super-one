/**
 * The delivery record's primitives against real SQLite
 * (`docs/design/session-sync-zone-delivery-record.md` §2, §3, §6).
 *
 * Every rule here is one the reviewer checked against the schema: the content
 * slot (P1), phase never moving on failure (P2), one handle for every write
 * so ownership changes only through `claimDelivery` (R7, Q3), content
 * identity fixed at seal (R6), the tombstone admission (P4), and the mirror's
 * classification reading `outcome` before `phase` (R4).
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import {
  abandonDelivery,
  advanceDelivery,
  claimDelivery,
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
  releaseDelivery,
  reserveDelivery,
  retryGivenUpDeliveries,
  type DeliveryHandle,
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
const SEAL = { total: 3, sha256: 'x' }

/** A download reserved by a live producer, at `writing`. */
function writing(overrides: Record<string, unknown> = {}): DeliveryHandle {
  const holder = mintHolder()
  const r = reserveDelivery({ ...base, localPath: P, holder, phase: 'writing', ...overrides })
  if (!('deliveryId' in r)) throw new Error(`reserve refused: ${r.refused}`)
  return { deliveryId: r.deliveryId, holder, epoch: 0 }
}

/** A produced file reserved complete, held by whoever is about to push it. */
function sealed(overrides: Record<string, unknown> = {}): DeliveryHandle {
  const holder = mintHolder()
  const r = reserveDelivery({ ...base, localPath: P, holder, phase: 'sealed', origin: 'produced', ...SEAL, ...overrides })
  if (!('deliveryId' in r)) throw new Error(`reserve refused: ${r.refused}`)
  return { deliveryId: r.deliveryId, holder, epoch: 0 }
}

/** Walk a handle forward, failing the test if any step is refused. */
function advanced(handle: DeliveryHandle, ...steps: Parameters<typeof advanceDelivery>[1][]): DeliveryHandle {
  for (const step of steps) {
    const r = advanceDelivery(handle, step)
    if (!r.ok) throw new Error(`advance refused: ${step.from} → ${step.to}`)
    handle = r.handle
  }
  return handle
}

describe('reserving a delivery', () => {
  it('creates the row before any byte is written, held by the producer', () => {
    const h = writing()
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'writing', outcome: null, holder: h.holder, epoch: 0, transferId: h.deliveryId })
  })

  it('refuses a path that already has any row, live or done (R2)', () => {
    const first = writing()
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'path-taken' })
    // Even after that delivery is over: a new version is a new path.
    abandonDelivery(advanced(first, { from: 'writing', to: 'sealed', ...SEAL }))
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'path-taken' })
  })

  it('refuses a session that has been dropped, even after a restart', () => {
    dropSessionDeliveries('s1')
    expect(reserveDelivery({ ...base, localPath: P, holder: mintHolder(), phase: 'writing' })).toEqual({ refused: 'session-dropped' })
    // The tombstone is a row, not a Set: it is there after the process is not.
    expect(db.prepare('SELECT count(*) AS n FROM session_zone_tombstones').get()).toEqual({ n: 1 })
  })

  it('lets a produced file start sealed and unheld, with its size and hash fixed', () => {
    const r = reserveDelivery({ ...base, localPath: P, holder: null, phase: 'sealed', origin: 'produced', total: 11, sha256: 'abc' })
    expect('deliveryId' in r && getDelivery(r.deliveryId)).toMatchObject({ phase: 'sealed', holder: null, total: 11, sha256: 'abc' })
  })

  it('keeps one content owner per path but lets a delivered row stand beside a new writer (P1)', () => {
    // Bypass R2 to test the index itself: the schema is the last line of defence.
    const t = writing()
    db.prepare(`UPDATE session_file_deliveries SET phase = 'uploaded' WHERE delivery_id = ?`).run(t.deliveryId)
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
  it('moves forward under the handle it was taken with, keeps the holder, and bumps the epoch', () => {
    const h = writing()
    const r = advanceDelivery(h, { from: 'writing', to: 'sealed', ...SEAL })
    expect(r).toEqual({ ok: true, handle: { deliveryId: h.deliveryId, holder: h.holder, epoch: 1 } })
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'sealed', holder: h.holder, epoch: 1, total: 3, sha256: 'x' })
  })

  it('refuses a stale epoch, a wrong phase, and any step backwards', () => {
    const h = writing()
    const s = advanced(h, { from: 'writing', to: 'sealed', ...SEAL })
    expect(advanceDelivery(h, { from: 'writing', to: 'sealed', ...SEAL })).toEqual({ ok: false })
    expect(advanceDelivery(h, { from: 'sealed', to: 'uploading' })).toEqual({ ok: false })
    expect(() => advanceDelivery(s, { from: 'sealed', to: 'writing' } as never)).toThrow(/backwards/)
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'sealed', epoch: 1 })
  })

  it('cannot advance another live holder’s committing delivery', () => {
    // Second review of §10.1: `advance` used to SET the holder without
    // checking the current one, so a worker that had merely read the epoch
    // could walk a row out from under the attempt awaiting its final put.
    const a = advanced(sealed(), { from: 'sealed', to: 'uploading' }, { from: 'uploading', to: 'committing' })
    const b = mintHolder()
    expect(claimDelivery(a.deliveryId, { holder: a.holder, epoch: a.epoch }, b)).toEqual({ ok: false })
    expect(advanceDelivery({ deliveryId: a.deliveryId, holder: b, epoch: a.epoch }, { from: 'committing', to: 'uploaded' })).toEqual({ ok: false })
    expect(getDelivery(a.deliveryId)).toMatchObject({ holder: a.holder, phase: 'committing', epoch: a.epoch })
    // A itself still advances.
    expect(advanceDelivery(a, { from: 'committing', to: 'uploaded' }).ok).toBe(true)
  })

  it('hands a sealed file from its producer to a worker only through release and claim', () => {
    const producer = advanced(writing(), { from: 'writing', to: 'sealed', ...SEAL })
    expect(releaseDelivery(producer)).toBe(true)
    expect(getDelivery(producer.deliveryId)).toMatchObject({ holder: null, epoch: 2 })
    const worker = mintHolder()
    const claimed = claimDelivery(producer.deliveryId, { holder: null, epoch: 2 }, worker)
    expect(claimed).toEqual({ ok: true, handle: { deliveryId: producer.deliveryId, holder: worker, epoch: 3 } })
    // The producer's old handle is dead on arrival.
    expect(releaseDelivery(producer)).toBe(false)
    expect(abandonDelivery(producer)).toBe(false)
    expect(advanceDelivery(producer, { from: 'sealed', to: 'uploading' })).toEqual({ ok: false })
  })

  it('keeps sealed content identity through every later phase (R6)', () => {
    const h = advanced(writing(), { from: 'writing', to: 'sealed', ...SEAL })
    // Nothing after seal accepts a new size or hash — not as a field, not as a type.
    const u = advanced(h, { from: 'sealed', to: 'uploading' })
    expect(advanceDelivery(u, { from: 'uploading', to: 'committing', total: 9, sha256: 'B' } as never)).toEqual({ ok: false })
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'uploading', total: 3, sha256: 'x' })
    expect(() => reserveDelivery({ ...base, localPath: '/zone/s1/other', relativePath: 'other', holder: null, phase: 'sealed' } as never)).toThrow(/sealed/)
  })

  it('records progress without changing the epoch, but not for a ghost', () => {
    const h = advanced(writing(), { from: 'writing', to: 'sealed', ...SEAL }, { from: 'sealed', to: 'uploading' })
    expect(recordDeliveryOffset(h, 2)).toBe(true)
    expect(recordDeliveryOffset({ ...h, epoch: h.epoch - 1 }, 3)).toBe(false)
    expect(recordDeliveryOffset({ ...h, holder: mintHolder() }, 3)).toBe(false)
    expect(getDelivery(h.deliveryId)).toMatchObject({ offset: 2, epoch: h.epoch })
  })

  it('completes only from notifying, and a completed row keeps answering for its path', () => {
    const h = advanced(
      writing(),
      { from: 'writing', to: 'sealed', ...SEAL },
      { from: 'sealed', to: 'uploading' },
      { from: 'uploading', to: 'committing' },
      { from: 'committing', to: 'uploaded' },
    )
    expect(completeDelivery(h)).toBe(false)
    const n = advanced(h, { from: 'uploaded', to: 'notifying' })
    expect(completeDelivery(n)).toBe(true)
    expect(getDelivery(h.deliveryId)).toMatchObject({ outcome: 'done', phase: 'notifying', holder: null })
    expect(findDeliveryByPath('s1', P)?.deliveryId).toBe(h.deliveryId)
  })
})

describe('failure is scheduling, never phase (P2)', () => {
  it('backs off an uploaded row without touching its phase, and releases the holder', () => {
    const h = advanced(sealed(), { from: 'sealed', to: 'uploading' }, { from: 'uploading', to: 'committing' }, { from: 'committing', to: 'uploaded' })
    expect(recordDeliveryFailure(h, { error: 'SQLITE_BUSY', nextAttemptAt: 1_000 })).toBe(true)
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'uploaded', holder: null, attempts: 1, lastError: 'SQLITE_BUSY', nextAttemptAt: 1_000, gaveUpAt: null })
  })

  it.each(['uploading', 'notifying'] as const)('reclaims an unheld %s retry without changing its phase', (phase) => {
    // Second review of §10.1: a failed attempt releases the holder, and the
    // next attempt has to pick the row up from NULL at that same phase.
    const steps = {
      uploading: [{ from: 'sealed', to: 'uploading' }],
      notifying: [
        { from: 'sealed', to: 'uploading' },
        { from: 'uploading', to: 'committing' },
        { from: 'committing', to: 'uploaded' },
        { from: 'uploaded', to: 'notifying' },
      ],
    }[phase] as Parameters<typeof advanceDelivery>[1][]
    const h = advanced(sealed(), ...steps)
    retireHolder(h.holder)
    expect(recordDeliveryFailure(h, { error: 'node away', nextAttemptAt: 500 })).toBe(true)
    const row = getDelivery(h.deliveryId)!
    expect(row).toMatchObject({ phase, holder: null })
    expect(listLiveDeliveries('c1', 500).map((d) => d.deliveryId)).toEqual([h.deliveryId])

    const next = mintHolder()
    const claimed = claimDelivery(h.deliveryId, { holder: null, epoch: row.epoch }, next)
    expect(claimed).toEqual({ ok: true, handle: { deliveryId: h.deliveryId, holder: next, epoch: row.epoch + 1 } })
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase, holder: next })

    // Released again; a stale "it was NULL at epoch N" snapshot cannot re-claim it.
    expect(releaseDelivery((claimed as { handle: DeliveryHandle }).handle)).toBe(true)
    expect(claimDelivery(h.deliveryId, { holder: null, epoch: row.epoch }, mintHolder())).toEqual({ ok: false })
    expect(claimDelivery(h.deliveryId, { holder: null, epoch: row.epoch + 2 }, mintHolder()).ok).toBe(true)
  })

  it('lets a person retry what gave up — except a commit nobody can verify', () => {
    // Q3 of the third review: the generic Retry must never send the original
    // path again once the final put may already have landed.
    const stuck = advanced(sealed(), { from: 'sealed', to: 'uploading' })
    recordDeliveryFailure(stuck, { error: 'node away', nextAttemptAt: null })
    const unverified = advanced(
      sealed({ localPath: '/zone/s1/download/other.csv', relativePath: 'download/other.csv', sha256: 'y' }),
      { from: 'sealed', to: 'uploading' },
      { from: 'uploading', to: 'committing' },
    )
    recordDeliveryFailure(unverified, { error: 'commit unverified', nextAttemptAt: null })

    expect(retryGivenUpDeliveries('s1')).toEqual([stuck.deliveryId])
    expect(getDelivery(stuck.deliveryId)).toMatchObject({ gaveUpAt: null, nextAttemptAt: null, attempts: 0 })
    expect(getDelivery(unverified.deliveryId)).toMatchObject({ phase: 'committing', gaveUpAt: expect.any(Number) })
  })

  it('gives up without touching the phase either', () => {
    const h = advanced(sealed(), { from: 'sealed', to: 'uploading' }, { from: 'uploading', to: 'committing' })
    expect(recordDeliveryFailure(h, { error: 'commit unverified', nextAttemptAt: null })).toBe(true)
    expect(getDelivery(h.deliveryId)).toMatchObject({ phase: 'committing', gaveUpAt: expect.any(Number), nextAttemptAt: null })
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
    const h = advanced(sealed(), { from: 'sealed', to: 'uploading' }, { from: 'uploading', to: 'committing' })
    expect(isHolderAlive(h.holder)).toBe(true)
    expect(claimDelivery(h.deliveryId, { holder: h.holder, epoch: h.epoch }, mintHolder())).toEqual({ ok: false })
    retireHolder(h.holder)
    expect(claimDelivery(h.deliveryId, { holder: h.holder, epoch: h.epoch }, mintHolder())).toMatchObject({ ok: true, handle: { epoch: 3 } })
  })

  it('takes over a dead holder in any phase and locks the ghost out', () => {
    const h = writing()
    // A previous process held it through `notifying` and died.
    db.prepare(`UPDATE session_file_deliveries SET phase = 'notifying', holder = 'old:1' WHERE delivery_id = ?`).run(h.deliveryId)
    const me = mintHolder()
    expect(claimDelivery(h.deliveryId, { holder: 'old:1', epoch: 0 }, me)).toEqual({ ok: true, handle: { deliveryId: h.deliveryId, holder: me, epoch: 1 } })
    expect(getDelivery(h.deliveryId)).toMatchObject({ holder: me, phase: 'notifying' })
    // The ghost's own next step, with the epoch it remembers, fails.
    expect(completeDelivery({ deliveryId: h.deliveryId, holder: 'old:1', epoch: 0 })).toBe(false)
    expect(claimDelivery(h.deliveryId, { holder: 'old:1', epoch: 0 }, mintHolder())).toEqual({ ok: false })
  })

  it('does not take over a holder that is merely busy', () => {
    const h = writing()
    expect(isHolderAlive(h.holder)).toBe(true)
    expect(claimDelivery(h.deliveryId, { holder: 'someone-else', epoch: 0 }, mintHolder())).toEqual({ ok: false })
    expect(claimDelivery(h.deliveryId, { holder: h.holder, epoch: 0 }, mintHolder())).toEqual({ ok: false })
    expect(getDelivery(h.deliveryId)).toMatchObject({ holder: h.holder, epoch: 0 })
  })
})

describe('dropping a session (P4)', () => {
  it('abandons every live row, tombstones the session, and invalidates the holders', () => {
    const a = writing()
    const b = writing({ localPath: '/zone/s1/download/other.csv', relativePath: 'download/other.csv' })
    const other = writing({ sessionId: 's2', localPath: '/zone/s2/x' })
    expect(dropSessionDeliveries('s1').sort()).toEqual([a.deliveryId, b.deliveryId].sort())
    expect(getDelivery(a.deliveryId)).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(getDelivery(other.deliveryId)).toMatchObject({ outcome: null })
    expect(advanceDelivery(a, { from: 'writing', to: 'sealed', ...SEAL })).toEqual({ ok: false })
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
    const due = writing()
    const later = writing({ localPath: '/zone/s1/later', relativePath: 'later' })
    recordDeliveryFailure(later, { error: 'x', nextAttemptAt: 5_000 })
    const gaveUp = writing({ localPath: '/zone/s1/gave-up', relativePath: 'gave-up' })
    recordDeliveryFailure(gaveUp, { error: 'x', nextAttemptAt: null })
    writing({ connectionId: 'c2', localPath: '/zone/s1/elsewhere', relativePath: 'elsewhere' })
    const dropped = writing({ sessionId: 's9', localPath: '/zone/s9/x', relativePath: 'x' })
    dropSessionDeliveries('s9')
    expect(listLiveDeliveries('c1', 1_000).map((d) => d.deliveryId)).toEqual([due.deliveryId])
    expect(listLiveDeliveries('c1', 5_000).map((d) => d.deliveryId).sort()).toEqual([due.deliveryId, later.deliveryId].sort())
    expect(getDelivery(dropped.deliveryId)?.outcome).toBe('abandoned')
  })
})
