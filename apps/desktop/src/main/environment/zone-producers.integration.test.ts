/**
 * Every producer that writes into a session zone, and the delivery row each
 * one leaves (`docs/design/session-sync-zone-delivery-record.md` §4).
 *
 * The rule follows the write mode, and so do the tests: a path factory has a
 * `writing` row before the path leaves it; a synchronous publish has a
 * `sealed` row in the same tick as the write; a re-registration reuses the
 * row instead of minting a second. Real producers, real SQLite, real call
 * scopes, real files. Stubbed: the database getter, Electron, the logger,
 * media grants, and — for the device backend — the platform's screencap.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const zone = vi.hoisted(() => ({ userData: '' }))
const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('../database', () => ({ getDb: getDbMock }))
const wire = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => void>() }))
vi.mock('electron', () => ({
  app: { getPath: () => zone.userData },
  session: {
    fromPartition: () => ({
      fetch: async () => ({ ok: false, status: 500, statusText: 'unused' }),
      on: (event: string, handler: (...args: unknown[]) => void) => void wire.handlers.set(event, handler),
    }),
  },
}))
vi.mock('../browser/browser-automation-bridge', () => ({ browserAutomationCall: vi.fn(async () => ({ webContentsIds: [] })) }))
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

import { advanceDelivery, claimDelivery, completeDelivery, dropSessionDeliveries, ensureSessionFileDeliveriesSchema, findDeliveryByPath, getDelivery, listSessionDeliveries } from '../db-session-deliveries'
import { isHolderAlive, mintHolder } from './delivery-holders'
import { registerBrowserDownloadCapture } from '../browser/browser-downloads'
import { rememberTabDriver } from '../browser/browser-tab-drivers'
import { adoptActionRecording } from '../agent/action-recording-store'
import { sealZoneFile, ZoneDeliveryRefused } from './zone-delivery'
import { collectArtifacts, releaseHeldDeliveries, resetArtifactRegistry, runInLocalCallScope, takeArtifacts, takeHeldDeliveries } from '../mcp/artifact-registry'
import { registerDownload, reserveDownloadPath } from '../agent/browser-download-store'
import { createActionRecordingPath, persistActionRecording } from '../agent/action-recording-store'
import { unlinkSync, writeFileSync } from 'node:fs'
import { persistBase64Screenshot } from '../agent/screenshot-artifact'
import { persistTextArtifact } from '../agent/browser-artifact-store'
import { persistImages } from '../media-gen/storage'
import { registerZoneArtifact } from '../media-gen/zone-artifact'
import { mediaGenOutputDir } from '../media-gen/paths'
import { _resetZoneDeliveryForTests } from './zone-delivery'

let db: Database.Database
let root: string
const S = 'sess-1'
const C = 'conn-1'
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const asRemote = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  // Model the executor's full call: after the scope, the held rows are drained
  // and — with no reply-selection in these producer tests — released to the worker.
  const result = await collectArtifacts(S, 'call', async () => fn(), C)
  releaseHeldDeliveries(takeHeldDeliveries(S, 'call'))
  return result
}

beforeEach(() => {
  db = new Database(':memory:')
  ensureSessionFileDeliveriesSchema(db)
  getDbMock.mockReturnValue(db)
  root = mkdtempSync(join(tmpdir(), 'zone-producers-'))
  zone.userData = root
  resetArtifactRegistry()
  _resetZoneDeliveryForTests()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('downloads: reserved before the first byte', () => {
  it('has a writing row for the exact path the wx create chose, before any byte', async () => {
    const path = await asRemote(() => reserveDownloadPath('report.csv', null, S))
    expect(statSync(path).size).toBe(0)
    const row = findDeliveryByPath(S, path)!
    expect(row).toMatchObject({ phase: 'writing', connectionId: C, origin: 'download', relativePath: 'download/report.csv' })
    expect(takeArtifacts(S, 'call')[0]).toMatchObject({ path, final: false, deliveryId: row.deliveryId })
  })

  it('seals the same row when the bytes are in, with their hash — held for the call, released after (E090-4)', async () => {
    let path = ''
    await asRemote(async () => {
      path = reserveDownloadPath('report.csv', null, S)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path, 'FIRSTSECOND')
      registerDownload(S, path, true)
      // Inside the call the sealed row is still held, so the worker cannot take
      // a file the reply may never name.
      const inCall = findDeliveryByPath(S, path)!
      expect(inCall).toMatchObject({ phase: 'sealed', total: 11, sha256: sha('FIRSTSECOND') })
      expect(isHolderAlive(inCall.holder!)).toBe(true)
      expect(takeArtifacts(S, 'call')[0]).toMatchObject({ final: true, deliveryId: expect.any(String) })
    })
    // The call ended: the row is released for the reply-selection / worker.
    expect(findDeliveryByPath(S, path)).toMatchObject({ phase: 'sealed', holder: null })
  })

  it('names a page download’s node from its tab driver, outside any call scope', () => {
    const path = reserveDownloadPath('page.pdf', null, S, { connectionId: C })
    expect(findDeliveryByPath(S, path)).toMatchObject({ phase: 'writing', connectionId: C, origin: 'page-download' })
  })

  it('reserves the hundred-and-first same-named file like every other', async () => {
    // The collision fallback used to hand back a path with no file created and
    // no claim taken: the one download the mirror could prune mid-stream.
    await asRemote(() => {
      for (let i = 0; i < 100; i++) reserveDownloadPath('dup.bin', null, S)
      const fallback = reserveDownloadPath('dup.bin', null, S)
      expect(fallback).toMatch(/dup \([0-9a-f]{8}\)\.bin$/)
      expect(existsSync(fallback)).toBe(true)
      expect(findDeliveryByPath(S, fallback)).toMatchObject({ phase: 'writing' })
    })
    expect(listSessionDeliveries(S)).toHaveLength(101)
  })

  it('chooses a new delivery path after a delivered filename disappears', async () => {
    // A vacancy on disk is not a free name under R2. OLD was delivered under
    // `reuse.txt`, the node deleted it and the mirror pruned the copy; a new
    // download of the same name must not slip into OLD's row and be reported
    // as already delivered.
    const oldPath = await asRemote(() => reserveDownloadPath('reuse.txt', null, S))
    writeFileSync(oldPath, 'OLD')
    await asRemote(() => registerDownload(S, oldPath, true))
    const oldRow = findDeliveryByPath(S, oldPath)!
    let h = (claimDelivery(oldRow.deliveryId, { holder: null, epoch: oldRow.epoch }, mintHolder()) as { handle: never }).handle as import('../db-session-deliveries').DeliveryHandle
    for (const step of [['sealed', 'uploading'], ['uploading', 'committing'], ['committing', 'uploaded'], ['uploaded', 'notifying']] as const) {
      h = (advanceDelivery(h, { from: step[0], to: step[1] } as never) as { handle: typeof h }).handle
    }
    expect(completeDelivery(h)).toBe(true)
    unlinkSync(oldPath)

    const newPath = await asRemote(() => reserveDownloadPath('reuse.txt', null, S))
    expect(newPath).not.toBe(oldPath)
    writeFileSync(newPath, 'NEW')
    await asRemote(() => registerDownload(S, newPath, true))
    const newRow = findDeliveryByPath(S, newPath)!
    expect(newRow.deliveryId).not.toBe(oldRow.deliveryId)
    expect(newRow).toMatchObject({ phase: 'sealed', sha256: sha('NEW') })
    expect(getDelivery(oldRow.deliveryId)).toMatchObject({ outcome: 'done', sha256: sha('OLD') })
  })

  it('seals a page download when DownloadItem completes without a listing', async () => {
    registerBrowserDownloadCapture()
    rememberTabDriver(7, S, C)
    const handler = wire.handlers.get('will-download')!
    let savePath = ''
    let done: ((event: unknown, state: string) => void) | undefined
    const item = {
      getFilename: () => 'page.pdf',
      getURL: () => 'https://x.test/page.pdf',
      getMimeType: () => 'application/pdf',
      getReceivedBytes: () => 8,
      setSavePath: (p: string) => void (savePath = p),
      once: (_e: string, fn: (event: unknown, state: string) => void) => void (done = fn),
    }
    handler(null, item, { id: 7 })
    const row = findDeliveryByPath(S, savePath)!
    expect(row).toMatchObject({ phase: 'writing', origin: 'page-download', connectionId: C })
    // Chromium writes the bytes and reports done. Nobody lists the downloads.
    writeFileSync(savePath, 'COMPLETE')
    done!(null, 'completed')
    expect(getDelivery(row.deliveryId)).toMatchObject({ phase: 'sealed', holder: null, sha256: sha('COMPLETE') })
    expect(isHolderAlive(row.holder)).toBe(false)
  })

  it('abandons a page download the item did not complete', () => {
    registerBrowserDownloadCapture()
    rememberTabDriver(8, S, C)
    let savePath = ''
    let done: ((event: unknown, state: string) => void) | undefined
    wire.handlers.get('will-download')!(null, {
      getFilename: () => 'gone.pdf', getURL: () => 'u', getMimeType: () => '', getReceivedBytes: () => 0,
      setSavePath: (p: string) => void (savePath = p), once: (_e: string, fn: typeof done) => void (done = fn),
    }, { id: 8 })
    const row = findDeliveryByPath(S, savePath)!
    done!(null, 'interrupted')
    expect(getDelivery(row.deliveryId)).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(isHolderAlive(row.holder)).toBe(false)
  })

  it('takes no row for a local session’s download, which lands in Downloads', async () => {
    await runInLocalCallScope(S, async () => {
      const path = reserveDownloadPath('report.csv', join(root, 'Downloads'), S)
      expect(path.startsWith(join(root, 'Downloads'))).toBe(true)
    })
    expect(listSessionDeliveries(S)).toEqual([])
  })
})

describe('recordings: reserved in the path factory', () => {
  it('has a writing row before the recorder has written anything', async () => {
    const path = await asRemote(() => createActionRecordingPath(S, 'computer', 'mp4'))
    expect(existsSync(path)).toBe(false)
    expect(findDeliveryByPath(S, path)).toMatchObject({ phase: 'writing', connectionId: C, holder: expect.any(String) })
  })

  it('seals through the same path when the buffer is persisted', async () => {
    const path = await asRemote(() => persistActionRecording(S, 'browser', Buffer.from('MP4').toString('base64'), 'video/mp4'))
    expect(findDeliveryByPath(S, path!)).toMatchObject({ phase: 'sealed', holder: null, total: 3, sha256: sha('MP4') })
    expect(listSessionDeliveries(S)).toHaveLength(1)
  })
})

describe('recordings: every exit closes the reservation', () => {
  it('abandons a recording reservation when its producer fails', async () => {
    // The source the helper was supposed to leave behind is not there. The
    // factory already spoke for the destination; the failure has to give it up,
    // or a live holder guards an empty path until the process ends.
    await asRemote(() => {
      expect(() => adoptActionRecording(S, 'device', join(root, 'missing.mp4'), Date.now())).toThrow(/ENOENT/)
    })
    const rows = listSessionDeliveries(S)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'abandoned', holder: null })
    expect(existsSync(rows[0]!.localPath)).toBe(false)
  })
})

describe('a reservation the session took with it', () => {
  it('does not publish a reservation invalidated by session deletion', async () => {
    const path = await asRemote(() => reserveDownloadPath('late.bin', null, S))
    const row = findDeliveryByPath(S, path)!
    dropSessionDeliveries(S)
    writeFileSync(path, 'LATE')
    await asRemote(() => expect(() => sealZoneFile({ sessionId: S, path, origin: 'download' })).toThrow(ZoneDeliveryRefused))
    expect(getDelivery(row.deliveryId)).toMatchObject({ outcome: 'abandoned', phase: 'writing' })
    expect(isHolderAlive(row.holder)).toBe(false)
    // And the registrar does not turn that into a final ref for the reply.
    await collectArtifacts(S, 'call-late', async () => {
      expect(() => registerDownload(S, path, true)).toThrow(ZoneDeliveryRefused)
    }, C)
    expect(takeArtifacts(S, 'call-late').filter((r) => r.final)).toEqual([])
  })
})

describe('synchronous publishes: sealed in the same tick as the write', () => {
  it('a screenshot, hashed from the buffer it was written from', async () => {
    const png = Buffer.from('not-really-a-png')
    const shot = await asRemote(() => persistBase64Screenshot({ sessionId: S, producer: 'browser' }, png.toString('base64'), 'image/png'))
    expect(findDeliveryByPath(S, shot!.path)).toMatchObject({ phase: 'sealed', total: png.length, sha256: sha(png) })
  })

  it('a spilled text result', async () => {
    const path = await asRemote(() => persistTextArtifact(S, '{"big":true}', 'json'))
    expect(findDeliveryByPath(S, path!)).toMatchObject({ phase: 'sealed', sha256: sha('{"big":true}') })
  })

  it('a generated image, and its re-registration at the status boundary reuses the row', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const saved = await asRemote(() => persistImages([{ uint8Array: bytes, base64: '', mediaType: 'image/png' }], mediaGenOutputDir(S), 'gen-1', false))
    const first = findDeliveryByPath(S, saved[0]!.path)!
    expect(first).toMatchObject({ phase: 'sealed', total: 4, sha256: sha(Buffer.from(bytes)) })
    await asRemote(() => registerZoneArtifact(saved[0]!.path))
    expect(listSessionDeliveries(S)).toHaveLength(1)
    expect(getDelivery(first.deliveryId)).toMatchObject({ phase: 'sealed', epoch: first.epoch })
  })

  it('a local session’s screenshot takes no row and is otherwise unchanged', async () => {
    const shot = await runInLocalCallScope(S, async () => persistBase64Screenshot({ sessionId: S, producer: 'browser' }, Buffer.from('x').toString('base64'), 'image/png'))
    expect(readFileSync(shot!.path, 'utf8')).toBe('x')
    expect(listSessionDeliveries(S)).toEqual([])
  })
})
