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
vi.mock('electron', () => ({
  app: { getPath: () => zone.userData },
  session: { fromPartition: () => ({ fetch: async () => ({ ok: false, status: 500, statusText: 'unused' }), on: () => {} }) },
}))
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../media-file-grants', () => ({ mediaFileGrants: () => ({ add: () => {} }) }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

import { ensureSessionFileDeliveriesSchema, findDeliveryByPath, getDelivery, listSessionDeliveries } from '../db-session-deliveries'
import { collectArtifacts, resetArtifactRegistry, runInLocalCallScope, takeArtifacts } from '../mcp/artifact-registry'
import { registerDownload, reserveDownloadPath } from '../agent/browser-download-store'
import { createActionRecordingPath, persistActionRecording } from '../agent/action-recording-store'
import { persistBase64Screenshot } from '../agent/screenshot-artifact'
import { persistTextArtifact } from '../agent/browser-artifact-store'
import { persistImages } from '../media-gen/storage'
import { registerZoneArtifact } from '../media-gen/zone-artifact'
import { mediaGenOutputDir } from '../media-gen/paths'
import { resetActiveWrites } from './active-writes'
import { _resetZoneDeliveryForTests } from './zone-delivery'

let db: Database.Database
let root: string
const S = 'sess-1'
const C = 'conn-1'
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const asRemote = <T>(fn: () => T | Promise<T>) => collectArtifacts(S, 'call', async () => fn(), C)

beforeEach(() => {
  db = new Database(':memory:')
  ensureSessionFileDeliveriesSchema(db)
  getDbMock.mockReturnValue(db)
  root = mkdtempSync(join(tmpdir(), 'zone-producers-'))
  zone.userData = root
  resetArtifactRegistry()
  resetActiveWrites()
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

  it('seals the same row when the bytes are in, with their hash', async () => {
    await asRemote(async () => {
      const path = reserveDownloadPath('report.csv', null, S)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(path, 'FIRSTSECOND')
      registerDownload(S, path, true)
      expect(findDeliveryByPath(S, path)).toMatchObject({ phase: 'sealed', holder: null, total: 11, sha256: sha('FIRSTSECOND') })
      expect(takeArtifacts(S, 'call')[0]).toMatchObject({ final: true, deliveryId: expect.any(String) })
    })
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
