/**
 * The producers' side of the delivery record
 * (`docs/design/session-sync-zone-delivery-record.md` §4).
 *
 * Two ways a file enters the zone — reserved before its first byte, or
 * published complete in one synchronous sequence — and one way it is
 * observed again. Real SQLite, real call scopes, real files; only the
 * database getter is stubbed.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const zone = vi.hoisted(() => ({ userData: '' }))
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('electron', () => ({ app: { getPath: () => zone.userData } }))
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

import { ensureSessionFileDeliveriesSchema, getDelivery, listSessionDeliveries } from '../db-session-deliveries'
import { isHolderAlive } from './delivery-holders'
import { collectArtifacts, resetArtifactRegistry, runInLocalCallScope, takeArtifacts } from '../mcp/artifact-registry'
import { ADHOC_SESSION_ID } from '../media-output-paths'
import { markZoneOwner } from './zone-owner'
import { abandonZoneFile, publishArtifact, publishZoneFileAt, reserveZoneFile, sealZoneFile, ZoneDeliveryRefused, zoneDestination } from './zone-delivery'

let db: Database.Database
let root: string
const S = 'sess-1'
const C = 'conn-1'

beforeEach(() => {
  db = new Database(':memory:')
  ensureSessionFileDeliveriesSchema(db)
  getDbMock.mockReturnValue(db)
  root = mkdtempSync(join(tmpdir(), 'zone-delivery-'))
  zone.userData = root
  resetArtifactRegistry()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const zonePath = (rel: string) => join(root, 'sync', S, rel)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** Run `fn` as a Host Action for `C`, the way a remote session's tool call runs. */
const asRemote = <T>(fn: () => T) => collectArtifacts(S, 'call-1', async () => fn(), C)

describe('where a zone file is going', () => {
  it('reads the node from the call scope, and local from a local call', async () => {
    await asRemote(() => expect(zoneDestination(S)).toEqual({ kind: 'remote', connectionId: C }))
    await runInLocalCallScope(S, async () => expect(zoneDestination(S)).toEqual({ kind: 'local' }))
  })

  it('takes an explicit destination over the scope, for producers that know theirs', async () => {
    await asRemote(() => expect(zoneDestination(S, 'conn-2')).toEqual({ kind: 'remote', connectionId: 'conn-2' }))
    await asRemote(() => expect(zoneDestination(S, null)).toEqual({ kind: 'local' }))
  })

  it('falls back to the zone’s owner marker outside any call, and is otherwise unknown', () => {
    expect(zoneDestination(S)).toEqual({ kind: 'unknown' })
    markZoneOwner(S, C)
    expect(zoneDestination(S)).toEqual({ kind: 'remote', connectionId: C })
    markZoneOwner('sess-local', null)
    expect(zoneDestination('sess-local')).toEqual({ kind: 'local' })
    expect(zoneDestination(ADHOC_SESSION_ID)).toEqual({ kind: 'local' })
  })
})

describe('a file reserved before its first byte', () => {
  it('has a writing row held by the producer before the path is handed out, and seals with its hash', async () => {
    const path = zonePath('recording/clip.mp4')
    mkdirSync(join(root, 'sync', S, 'recording'), { recursive: true })
    const id = await asRemote(() => reserveZoneFile({ sessionId: S, path, origin: 'produced' }))
    expect(id).toEqual(expect.any(String))
    const row = getDelivery(id!)!
    expect(row).toMatchObject({ phase: 'writing', connectionId: C, holder: expect.any(String) })
    expect(isHolderAlive(row.holder)).toBe(true)

    // The writer fills it — however long that takes — and then declares it done.
    writeFileSync(path, 'FRAMES')
    const sealed = await asRemote(() => sealZoneFile({ sessionId: S, path, origin: 'produced' }))
    expect(sealed).toBe(id)
    expect(getDelivery(id!)).toMatchObject({ phase: 'sealed', holder: null, total: 6, sha256: sha('FRAMES') })
    // The producer's attempt is over.
    expect(isHolderAlive(row.holder)).toBe(false)
  })

  it('is abandoned, and its holder retired, when the writer gives up', async () => {
    const path = zonePath('download/x.bin')
    const id = await asRemote(() => reserveZoneFile({ sessionId: S, path, origin: 'download' }))
    const holder = getDelivery(id!)!.holder
    abandonZoneFile(S, path)
    expect(getDelivery(id!)).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(isHolderAlive(holder)).toBe(false)
  })

  it('takes no row for a local session, and none outside the zone', async () => {
    await runInLocalCallScope(S, async () => {
      expect(reserveZoneFile({ sessionId: S, path: zonePath('download/x.bin'), origin: 'download' })).toBeNull()
    })
    await asRemote(() => expect(reserveZoneFile({ sessionId: S, path: join(root, 'Downloads', 'x.bin'), origin: 'download' })).toBeNull())
    expect(listSessionDeliveries(S)).toEqual([])
  })

  it('refuses, rather than guesses, when a zone file has no known destination', () => {
    // No call scope, no owner marker: not local, not any node. A file produced
    // here would be promised to nobody and protected by nothing.
    expect(() => reserveZoneFile({ sessionId: S, path: zonePath('download/x.bin'), origin: 'download' })).toThrow(ZoneDeliveryRefused)
    expect(listSessionDeliveries(S)).toEqual([])
  })

  it('refuses a path that has been written once already (R2)', async () => {
    const path = zonePath('download/x.bin')
    await asRemote(() => reserveZoneFile({ sessionId: S, path, origin: 'download' }))
    abandonZoneFile(S, path)
    await asRemote(() => expect(() => reserveZoneFile({ sessionId: S, path, origin: 'download' })).toThrow(/path-taken/))
  })
})

describe('a file published complete in one step', () => {
  it('lands sealed and unheld, hashed from the bytes it was written from', async () => {
    const path = zonePath('browser/shot.png')
    mkdirSync(join(root, 'sync', S, 'browser'), { recursive: true })
    const bytes = Buffer.from('PNG-BYTES')
    writeFileSync(path, bytes)
    const id = await asRemote(() => sealZoneFile({ sessionId: S, path, origin: 'produced', bytes }))
    expect(getDelivery(id!)).toMatchObject({ phase: 'sealed', holder: null, total: bytes.length, sha256: sha(bytes) })
  })

  it('hashes the file itself when the producer has no buffer left', async () => {
    const path = zonePath('media-gen/out.png')
    mkdirSync(join(root, 'sync', S, 'media-gen'), { recursive: true })
    writeFileSync(path, Buffer.alloc(3 * 1024 * 1024, 7))
    const id = await asRemote(() => sealZoneFile({ sessionId: S, path, origin: 'produced' }))
    expect(getDelivery(id!)).toMatchObject({ total: 3 * 1024 * 1024, sha256: sha(Buffer.alloc(3 * 1024 * 1024, 7)) })
  })

  it('reuses the delivery when the same file is registered again (R3a)', async () => {
    const path = zonePath('browser/shot.png')
    mkdirSync(join(root, 'sync', S, 'browser'), { recursive: true })
    writeFileSync(path, 'x')
    const first = await asRemote(() => sealZoneFile({ sessionId: S, path, origin: 'produced' }))
    db.prepare(`UPDATE session_file_deliveries SET phase = 'uploaded' WHERE delivery_id = ?`).run(first)
    // A later listing names it again: same id, no second row, no reset.
    const again = await asRemote(() => sealZoneFile({ sessionId: S, path, origin: 'produced' }))
    expect(again).toBe(first)
    expect(listSessionDeliveries(S)).toHaveLength(1)
    expect(getDelivery(first!)).toMatchObject({ phase: 'uploaded' })
  })
})

describe('a backend that writes but does not register', () => {
  it('seals the row from the path alone, so the executor’s later registration finds it', async () => {
    // Device backends write a capture and return its path; the device executor
    // registers it after an await or two. The row has to exist before that.
    const path = zonePath('android/cap.png')
    mkdirSync(join(root, 'sync', S, 'android'), { recursive: true })
    const png = Buffer.from('PNG')
    writeFileSync(path, png)
    await asRemote(() => publishZoneFileAt(path, png))
    const row = getDelivery(listSessionDeliveries(S)[0]!.deliveryId)!
    expect(row).toMatchObject({ phase: 'sealed', sha256: sha(png), relativePath: 'android/cap.png' })
    await collectArtifacts(S, 'call-x', async () => publishArtifact(S, { path, producer: 'android', final: true }), C)
    expect(takeArtifacts(S, 'call-x')[0]).toMatchObject({ deliveryId: row.deliveryId })
    expect(listSessionDeliveries(S)).toHaveLength(1)
  })

  it('does nothing for a path outside any zone', () => {
    publishZoneFileAt(join(root, 'elsewhere.png'), Buffer.from('x'))
    expect(listSessionDeliveries(S)).toEqual([])
  })
})

describe('registering an artifact', () => {
  it('records the delivery id on the ref the Host Action will push', async () => {
    const path = zonePath('browser/shot.png')
    mkdirSync(join(root, 'sync', S, 'browser'), { recursive: true })
    writeFileSync(path, 'x')
    await collectArtifacts(S, 'call-2', async () => publishArtifact(S, { path, producer: 'browser', final: true }), C)
    const [ref] = takeArtifacts(S, 'call-2')
    expect(ref).toMatchObject({ path, final: true, deliveryId: expect.any(String) })
    expect(getDelivery(ref!.deliveryId!)).toMatchObject({ phase: 'sealed' })
  })

  it('keeps a reservation’s id on a non-final registration, and seals it on the final one', async () => {
    const path = zonePath('download/x.bin')
    mkdirSync(join(root, 'sync', S, 'download'), { recursive: true })
    await collectArtifacts(
      S,
      'call-3',
      async () => {
        const id = reserveZoneFile({ sessionId: S, path, origin: 'download' })
        publishArtifact(S, { path, producer: 'download', final: false })
        expect(takeArtifacts(S, 'call-3')[0]).toMatchObject({ final: false, deliveryId: id })
        writeFileSync(path, 'DATA')
        publishArtifact(S, { path, producer: 'download', final: true })
        expect(getDelivery(id!)).toMatchObject({ phase: 'sealed', total: 4 })
      },
      C,
    )
  })

  it('registers a local session’s file with no delivery, exactly as before', async () => {
    const path = zonePath('browser/shot.png')
    mkdirSync(join(root, 'sync', S, 'browser'), { recursive: true })
    writeFileSync(path, 'x')
    await runInLocalCallScope(S, async () => publishArtifact(S, { path, producer: 'browser', final: true }))
    expect(listSessionDeliveries(S)).toEqual([])
    expect(existsSync(path)).toBe(true)
  })
})
