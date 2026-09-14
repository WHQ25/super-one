import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A download streaming into a session zone, and a directory mirror of the same
 * zone directory running while it streams.
 *
 * These are the two halves of the window the transfer job table cannot see: a
 * job row exists only once a file is finished AND enqueued, so between the
 * reservation and the handoff the mirror is looking at a real file the node has
 * never listed. Everything here is real — the reservation, the artifact
 * registry, the active-write registry, the mirror and the filesystem — with the
 * node's `list`/`stat`/`get` standing in for the wire.
 */
const state = vi.hoisted(() => ({ userData: '', jobs: [] as { sessionId: string; relativePath: string; state: string }[] }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../db-artifact-transfers', () => ({
  listArtifactTransfersForSession: (sessionId: string) => state.jobs.filter((j) => j.sessionId === sessionId),
}))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))

import { registerDownload, reserveDownloadPath } from '../agent/browser-download-store'
import { endActiveWrite, resetActiveWrites } from './active-writes'
import { mirrorNodeDirectory } from './session-file-mirror'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dl-race-'))
  state.userData = root
  state.jobs = []
  resetActiveWrites()
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
    // unrelated member is where it interleaves.
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(readFileSync(path, 'utf8')).toBe('FIRST')

    writeFileSync(path, 'FIRSTSECOND')
    registerDownload('s1', path, true)
    expect(readFileSync(path, 'utf8')).toBe('FIRSTSECOND')
  })

  it('stays protected after sealing until a transfer job takes over, then prunes', async () => {
    const path = reserveDownloadPath('report.csv', join(root, 'sync', 's1', 'agent', 'app'), 's1', origin)
    writeFileSync(path, 'ALL-BYTES')
    // Sealed: complete, but the eager push has not run and no job row exists.
    registerDownload('s1', path, true)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(true)

    // Handoff: the job row is now what protects it, so the claim is released.
    state.jobs = [{ sessionId: 's1', relativePath: 'agent/app/report.csv', state: 'pending' }]
    endActiveWrite('s1', path)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(true)

    // Uploaded and acknowledged: nothing owns it, so a stale member is pruned.
    state.jobs = []
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(false)
  })

  it('does not leave a cancelled download protecting its path forever', async () => {
    const path = reserveDownloadPath('report.csv', join(root, 'sync', 's1', 'agent', 'app'), 's1', origin)
    writeFileSync(path, 'HALF')
    // `will-download` reports `cancelled`; there is nothing to hand on.
    endActiveWrite('s1', path)
    await mirrorNodeDirectory('s1', 'agent/app', nodeWithOldFile())
    expect(existsSync(path)).toBe(false)
  })
})
