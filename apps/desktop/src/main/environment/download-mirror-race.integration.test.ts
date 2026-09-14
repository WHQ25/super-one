import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A download streaming into a session zone, and a directory mirror of the same
 * zone directory running while it streams.
 *
 * This is the window between a download's reservation and its delivery: the
 * `writing` row protects a real file the node has never listed, the `sealed`
 * row is a complete original still owed to the node, and only once the worker
 * has delivered it (outcome `done`) does the mirror prune. Everything here is
 * real — the reservation, the artifact registry, the delivery record, the
 * mirror and the filesystem — with the node's `list`/`stat`/`get` for the wire.
 */
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

import { registerDownload, reserveDownloadPath } from '../agent/browser-download-store'
import { abandonZoneFile } from './zone-delivery'
import { findDeliveryByPath } from '../db-session-deliveries'
import { deliveryDb, resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests } from './delivery-holders'
import { mirrorNodeDirectory } from './session-file-mirror'

/** Advance the delivery of `path` to the state a completed worker would leave. */
function markDelivered(sessionId: string, path: string): void {
  const row = findDeliveryByPath(sessionId, path)!
  deliveryDb().prepare(`UPDATE session_file_deliveries SET phase = 'notifying', outcome = 'done', holder = NULL WHERE delivery_id = ?`).run(row.deliveryId)
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dl-race-'))
  state.userData = root
  resetDeliveryDatabase()
  _resetHoldersForTests()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A node that holds `agent/app/old.txt` and nothing else. */
function nodeWithOldFile(onGet?: () => void) {
  const files: Record<string, Buffer> = { 'agent/app/old.txt': Buffer.from('old') }
  return {
    connectionId: 'conn-1',
    stat: async ({ relativePath }: { relativePath: string }) => {
      const f = files[relativePath]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      onGet?.()
      const f = files[req.relativePath]!
      const slice = f.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
    },
    list: async ({ relativePath }: { relativePath: string }) => {
      const entries = Object.keys(files)
        .filter((rel) => rel.startsWith(`${relativePath}/`))
        .map((rel) => ({ relativePath: rel, size: files[rel]!.length, mtimeMs: 1_700_000_000_000 }))
      return { exists: entries.length > 0, entries, truncated: false }
    },
  }
}

describe('a download streaming into a directory the agent also mirrors', () => {
  const origin = { connectionId: 'conn-1' }
  const dir = () => join(root, 'sync', 's1', 'download')

  it('survives a mirror of its own directory that runs before its first byte lands', async () => {
    // The reservation is an empty `wx` create: the file exists, is zero bytes,
    // and no transfer job names it. This is the exact state Casey reproduced.
    const path = reserveDownloadPath('report.csv', dir(), 's1', origin)
    expect(existsSync(path)).toBe(true)

    const outcome = await mirrorNodeDirectory('s1', 'download', nodeWithOldFile())
    expect(outcome.kind).toBe('missing')
    expect(existsSync(path)).toBe(true)
  })

  it('survives a mirror that runs between the first chunk and the last', async () => {
    const path = reserveDownloadPath('report.csv', join(root, 'sync', 's1', 'agent', 'app'), 's1', origin)
    writeFileSync(path, 'FIRST')

    // The mirror runs while the body is still open — the node's get for the
    // unrelated member is where it interleaves. The file survives, and the
    // directory is not offered as a complete input while it is half-written.
    const mid = await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(mid).toMatchObject({ kind: 'unavailable' })
    expect(readFileSync(path, 'utf8')).toBe('FIRST')

    writeFileSync(path, 'FIRSTSECOND')
    registerDownload('s1', path, true)
    expect(readFileSync(path, 'utf8')).toBe('FIRSTSECOND')
  })

  it('stays protected after sealing until the worker delivers it, then prunes', async () => {
    const path = reserveDownloadPath('report.csv', join(root, 'sync', 's1', 'agent', 'app'), 's1', origin)
    writeFileSync(path, 'ALL-BYTES')
    // Sealed: complete, a desktop original still owed to the node (the eager
    // push has not run and the worker has not taken it).
    registerDownload('s1', path, true)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(true)

    // Delivered: the node has the bytes and the wake is done, so a stale member
    // is now the node's to say what exists — and it does not list it.
    markDelivered('s1', path)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(false)
  })

  it('does not leave a cancelled download protecting its path forever', async () => {
    const path = reserveDownloadPath('report.csv', join(root, 'sync', 's1', 'agent', 'app'), 's1', origin)
    writeFileSync(path, 'HALF')
    // `will-download` reports `cancelled`; there is nothing to hand on.
    abandonZoneFile('s1', path)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(false)
  })
})
