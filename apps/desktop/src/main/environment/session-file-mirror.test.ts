import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { mirrorNodeArtifact, mirrorNodeDirectory } from './session-file-mirror'

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

  it('keeps a desktop-produced copy whose upload is still pending, and reports a file neither side has as missing', async () => {
    const remote = { ...node({}), isPendingUpload: (_s: string, rel: string) => rel === 'browser/shot.png' }
    const local = join(root, 'sync', 's1', 'browser', 'shot.png')
    mkdirSync(join(root, 'sync', 's1', 'browser'), { recursive: true })
    writeFileSync(local, 'png')
    expect(await mirrorNodeArtifact('s1', 'browser/shot.png', remote)).toMatchObject({ kind: 'local', path: local, size: 3 })
    expect(await mirrorNodeArtifact('s1', 'browser/nothing.png', remote)).toEqual({ kind: 'missing' })
  })

  it('reports a file the node deleted as missing even though a mirror copy is on disk', async () => {
    // The node is authoritative for what exists; a copy with no upload pending is a leftover.
    const remote = { ...node({}), isPendingUpload: () => false }
    const local = join(root, 'sync', 's1', 'agent', 'report.md')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    writeFileSync(local, 'old')
    expect(await mirrorNodeArtifact('s1', 'agent/report.md', remote)).toEqual({ kind: 'missing' })
  })

  it('records which node a mirrored directory belongs to, so the sweep can ask it', async () => {
    // A zone directory that only ever held mirrored files was never marked,
    // and an unmarked directory is kept forever.
    const report = Buffer.from('# hi')
    const remote = {
      connectionId: 'conn-1',
      stat: async () => ({ exists: true, size: report.length, mtimeMs: 1_700_000_000_000 }),
      get: async () => ({ chunk: report.toString('base64'), total: report.length, mtimeMs: 1_700_000_000_000, eof: true }),
      isPendingUpload: () => false,
    }
    await mirrorNodeArtifact('s1', 'agent/report.md', remote)
    expect(readFileSync(join(root, 'sync', 's1', '.owner'), 'utf8')).toBe('conn-1')
  })

  it('separates a node that refuses from a node that says the file is gone', async () => {
    // Both used to read as `missing`, and `missing` lets a caller fall
    // through to whatever copy sits at the desktop path. Only `not_found` is
    // an answer about the file; the rest are answers about the request.
    const local = join(root, 'sync', 's1', 'agent', 'a.txt')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    writeFileSync(local, 'cached')
    const refusing = (code: string) => ({
      stat: async () => { throw Object.assign(new Error(code), { code }) },
      get: async () => { throw new Error('unreachable') },
      isPendingUpload: () => false,
    })
    expect(await mirrorNodeArtifact('s1', 'agent/a.txt', refusing('not_found'))).toEqual({ kind: 'missing' })
    expect(await mirrorNodeArtifact('s1', 'agent/a.txt', refusing('forbidden'))).toMatchObject({ kind: 'unavailable' })
    expect(await mirrorNodeArtifact('s1', 'agent/a.txt', refusing('invalid_argument'))).toMatchObject({ kind: 'unavailable' })
  })

  it('falls back to the local copy when the node cannot be reached', async () => {
    const local = join(root, 'sync', 's1', 'agent', 'a.txt')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    writeFileSync(local, 'cached')
    const offline = { stat: async () => { throw new Error('not connected') }, get: async () => { throw new Error('not connected') }, isPendingUpload: () => false }
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

describe('node directory mirror', () => {
  function fakeNode(files: Record<string, Buffer>, opts: { truncated?: boolean } = {}) {
    const stat = async ({ relativePath }: { relativePath: string }) => {
      const f = files[relativePath]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    }
    const get = async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      const f = files[req.relativePath]
      const slice = f.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
    }
    const list = async ({ relativePath }: { relativePath: string }) => {
      const entries = Object.entries(files)
        .filter(([rel]) => rel.startsWith(relativePath + '/'))
        .map(([rel, buf]) => ({ relativePath: rel, size: buf.length, mtimeMs: 1_700_000_000_000 }))
      return { exists: entries.length > 0, entries, truncated: opts.truncated ?? false }
    }
    return { stat, get, list, isPendingUpload: () => false, connectionId: 'conn-1' }
  }

  it('brings every file of a node directory to the desktop mirror and drops what the node no longer has', async () => {
    // A tool that reads a directory reads all of it. A stale desktop file the
    // node deleted would be part of "all of it" — so the mirror is made
    // faithful, not merely superset.
    const stale = join(root, 'sync', 's1', 'agent', 'app', 'old.js')
    mkdirSync(join(stale, '..'), { recursive: true })
    writeFileSync(stale, 'gone on the node')
    const node = fakeNode({ 'agent/app/manifest.json': Buffer.from('{}'), 'agent/app/src/index.js': Buffer.from('export {}') })
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(outcome).toMatchObject({ kind: 'local', path: join(root, 'sync', 's1', 'agent', 'app') })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'app', 'manifest.json'), 'utf8')).toBe('{}')
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'app', 'src', 'index.js'), 'utf8')).toBe('export {}')
    expect(existsSync(stale)).toBe(false)
  })

  it('reports a directory the node does not have as missing, and one it could not list whole as unavailable', async () => {
    expect(await mirrorNodeDirectory('s1', 'agent/none', fakeNode({}))).toEqual({ kind: 'missing' })
    const partial = fakeNode({ 'agent/big/a.txt': Buffer.from('a') }, { truncated: true })
    expect(await mirrorNodeDirectory('s1', 'agent/big', partial)).toMatchObject({ kind: 'unavailable' })
  })
})
