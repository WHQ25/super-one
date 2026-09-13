import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { mirrorNodeArtifact } from './session-file-mirror'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mirror-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function node(files: Record<string, { data: Buffer; mtimeMs: number }>) {
  const gets: number[] = []
  return {
    gets,
    stat: async ({ relativePath }: { relativePath: string }) => {
      const f = files[relativePath]
      return f ? { exists: true, size: f.data.length, mtimeMs: f.mtimeMs } : { exists: false, size: 0, mtimeMs: 0 }
    },
    get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      gets.push(req.offset)
      const f = files[req.relativePath]!
      const slice = f.data.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.data.length, mtimeMs: f.mtimeMs, eof: req.offset + slice.length >= f.data.length }
    },
  }
}

describe('node artifact mirror', () => {
  it('fetches an agent-written file the desktop has never seen into the session zone', async () => {
    const remote = node({ 'agent/report.md': { data: Buffer.from('# report'), mtimeMs: 1_500_000_000_000 } })
    const outcome = await mirrorNodeArtifact('s1', 'agent/report.md', remote)
    expect(outcome).toEqual({ kind: 'local', path: join(root, 'sync', 's1', 'agent', 'report.md'), size: 8, mtimeMs: 1_500_000_000_000 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'report.md'), 'utf8')).toBe('# report')
  })

  it('serves a copy whose size and mtime match the node without fetching, and refreshes one that drifted', async () => {
    const remote = node({ 'media-gen/g.preview.jpg': { data: Buffer.from('v2-bytes'), mtimeMs: 1_500_000_000_000 } })
    const local = join(root, 'sync', 's1', 'media-gen', 'g.preview.jpg')
    await mirrorNodeArtifact('s1', 'media-gen/g.preview.jpg', remote)
    expect(remote.gets).toEqual([0])
    await mirrorNodeArtifact('s1', 'media-gen/g.preview.jpg', remote)
    expect(remote.gets).toEqual([0])
    // The node rewrote the preview in place (same size, new mtime): the copy is refetched.
    utimesSync(local, 1_400_000_000, 1_400_000_000)
    const refreshed = await mirrorNodeArtifact('s1', 'media-gen/g.preview.jpg', remote)
    expect(remote.gets).toEqual([0, 0])
    expect(Math.floor(statSync(refreshed.kind === 'local' ? refreshed.path : '').mtimeMs)).toBe(1_500_000_000_000)
  })

  it('keeps a desktop-produced copy the node never received, and reports a file neither side has as missing', async () => {
    const remote = node({})
    const local = join(root, 'sync', 's1', 'browser', 'shot.png')
    mkdirSync(join(root, 'sync', 's1', 'browser'), { recursive: true })
    writeFileSync(local, 'png')
    expect(await mirrorNodeArtifact('s1', 'browser/shot.png', remote)).toMatchObject({ kind: 'local', path: local, size: 3 })
    expect(await mirrorNodeArtifact('s1', 'browser/nothing.png', remote)).toEqual({ kind: 'missing' })
  })

  it('falls back to the local copy when the node cannot be reached', async () => {
    const local = join(root, 'sync', 's1', 'agent', 'a.txt')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    writeFileSync(local, 'cached')
    const offline = { stat: async () => { throw new Error('not connected') }, get: async () => { throw new Error('not connected') } }
    expect(await mirrorNodeArtifact('s1', 'agent/a.txt', offline)).toMatchObject({ kind: 'local', path: local })
    expect(await mirrorNodeArtifact('s1', 'agent/b.txt', offline)).toEqual({ kind: 'missing' })
  })

  it('shares one download between concurrent readers of the same file', async () => {
    const remote = node({ 'agent/r.md': { data: Buffer.alloc(10, 1), mtimeMs: 1_500_000_000_000 } })
    const [a, b] = await Promise.all([mirrorNodeArtifact('s1', 'agent/r.md', remote), mirrorNodeArtifact('s1', 'agent/r.md', remote)])
    expect(a).toEqual(b)
    expect(remote.gets).toEqual([0])
  })
})
