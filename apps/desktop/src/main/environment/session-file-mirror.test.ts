import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', jobs: [] as { sessionId: string; relativePath: string; state: string }[] }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
// The real job table, live: the mirror must read it at the moment it deletes or
// overwrites, not from a snapshot taken before the first fetch started.
vi.mock('../db-artifact-transfers', () => ({
  listArtifactTransfersForSession: (sessionId: string) => state.jobs.filter((j) => j.sessionId === sessionId),
}))

import { beginActiveWrite, endActiveWrite, resetActiveWrites } from './active-writes'
import { mirrorNodeArtifact, mirrorNodeDirectory } from './session-file-mirror'

function liveNode(files: Record<string, Buffer>, opts: { onGet?: (rel: string) => Promise<void> | void } = {}) {
  return {
    connectionId: 'conn-1',
    stat: async ({ relativePath }: { relativePath: string }) => {
      const f = files[relativePath]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      await opts.onGet?.(req.relativePath)
      const f = files[req.relativePath]!
      const slice = f.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
    },
    list: async ({ relativePath }: { relativePath: string }) => {
      const entries = Object.keys(files)
        .filter((rel) => rel.startsWith(relativePath + '/'))
        .map((rel) => ({ relativePath: rel, size: files[rel]!.length, mtimeMs: 1_700_000_000_000 }))
      return { exists: entries.length > 0, entries, truncated: false }
    },
  }
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mirror-'))
  state.userData = root
  state.jobs = []
  resetActiveWrites()
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

describe('node directory mirror — safety under conflict, cancellation and staleness', () => {
  function dirNode(files: Record<string, Buffer>, opts: { truncated?: boolean; pending?: Set<string>; signal?: AbortSignal } = {}) {
    const at = (rel: string) => files[rel]
    return {
      connectionId: 'conn-1',
      signal: opts.signal,
      isPendingUpload: (_s: string, rel: string) => opts.pending?.has(rel) ?? false,
      stat: async ({ relativePath }: { relativePath: string }) => {
        const f = at(relativePath)
        return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
      },
      get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
        const f = at(req.relativePath)!
        const slice = f.subarray(req.offset, req.offset + req.maxBytes)
        return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
      },
      list: async ({ relativePath }: { relativePath: string }) => {
        const entries = Object.keys(files)
          .filter((rel) => rel.startsWith(relativePath + '/'))
          .map((rel) => ({ relativePath: rel, size: files[rel]!.length, mtimeMs: 1_700_000_000_000 }))
        return { exists: entries.length > 0, entries, truncated: opts.truncated ?? false }
      },
    }
  }

  it('does not delete a desktop original whose upload is still pending, even when the node has not listed it', async () => {
    // X3: the desktop just produced assets/new.png; it is queued for upload and
    // not on the node yet. A mirror of the directory must not delete the only copy.
    const original = join(root, 'sync', 's1', 'agent', 'app', 'assets', 'new.png')
    mkdirSync(join(original, '..'), { recursive: true })
    writeFileSync(original, 'fresh-desktop-bytes')
    const node = dirNode({ 'agent/app/manifest.json': Buffer.from('{}') }, { pending: new Set(['agent/app/assets/new.png']) })
    await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(existsSync(original)).toBe(true)
  })

  it('drops a file the node dropped between listing and fetch, rather than keeping it because the listing named it', async () => {
    // X7: keep is built from what actually mirrored, not from the stale listing.
    const gone = join(root, 'sync', 's1', 'agent', 'app', 'gone.txt')
    mkdirSync(join(gone, '..'), { recursive: true })
    writeFileSync(gone, 'old')
    const files: Record<string, Buffer> = { 'agent/app/keep.txt': Buffer.from('k'), 'agent/app/gone.txt': Buffer.from('g') }
    const node = dirNode(files)
    const realStat = node.stat
    node.stat = async (input) => (input.relativePath === 'agent/app/gone.txt' ? { exists: false, size: 0, mtimeMs: 0 } : realStat(input))
    await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(existsSync(gone)).toBe(false)
    expect(existsSync(join(root, 'sync', 's1', 'agent', 'app', 'keep.txt'))).toBe(true)
  })

  it('replaces a desktop file with a directory when the node turned it into one', async () => {
    // X9: foo was a file on the desktop, foo/bar on the node.
    const asFile = join(root, 'sync', 's1', 'agent', 'app', 'foo')
    mkdirSync(join(asFile, '..'), { recursive: true })
    writeFileSync(asFile, 'was a file')
    const node = dirNode({ 'agent/app/foo/bar.txt': Buffer.from('now nested') })
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(outcome.kind).toBe('local')
    expect(readFileSync(join(asFile, 'bar.txt'), 'utf8')).toBe('now nested')
  })

  it('replaces a desktop directory with a file when the node turned it into one', async () => {
    // X9, the other way: foo/ on the desktop, foo a file on the node.
    const asDir = join(root, 'sync', 's1', 'agent', 'app', 'foo')
    mkdirSync(join(asDir, 'stale'), { recursive: true })
    writeFileSync(join(asDir, 'stale', 'x.txt'), 'stale')
    const node = dirNode({ 'agent/app/foo': Buffer.from('now a file') })
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(outcome.kind).toBe('local')
    expect(readFileSync(asDir, 'utf8')).toBe('now a file')
  })

  it('refuses to prune through a mirror root that is a symlink out of the zone, leaving the target untouched', async () => {
    // X1: sync/s1/agent/app is a link to a directory outside the zone; a naive
    // prune would readdir the link and delete files that are not the mirror's.
    const outside = mkdtempSync(join(tmpdir(), 'mirror-outside-'))
    const sentinel = join(outside, 'keepme.txt')
    writeFileSync(sentinel, 'not ours to delete')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    const { symlinkSync } = await import('node:fs')
    symlinkSync(outside, join(root, 'sync', 's1', 'agent', 'app'))
    try {
      const node = dirNode({ 'agent/app/manifest.json': Buffer.from('{}') })
      const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
      expect(outcome.kind).toBe('unavailable')
      expect(existsSync(sentinel)).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('marks the zone owner before any bytes are staged, so a crash mid-mirror leaves a markable directory', async () => {
    // X12: the .owner marker is what the sweep needs; a first mirror that
    // crashed after opening a .part but before finishing must not leave an
    // unmarked directory the sweep then keeps forever.
    let sawOwnerDuringGet = false
    const big = Buffer.alloc(3, 7)
    const node = dirNode({ 'agent/app/a.bin': big })
    const realGet = node.get
    node.get = async (req) => {
      try { sawOwnerDuringGet ||= readFileSync(join(root, 'sync', 's1', '.owner'), 'utf8') === 'conn-1' } catch { /* not yet */ }
      return realGet(req)
    }
    await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(sawOwnerDuringGet).toBe(true)
  })

  it('does not prune when the mirror was cancelled, leaving prior files in place', async () => {
    // X11: a cancel arriving during the list must abort before the prune runs.
    const stale = join(root, 'sync', 's1', 'agent', 'app', 'prior.txt')
    mkdirSync(join(stale, '..'), { recursive: true })
    writeFileSync(stale, 'prior')
    const controller = new AbortController()
    // The hard case (miniapp_dev_pack cancelled while listing): the list comes
    // back empty *after* the abort, so no member fetch is there to notice it —
    // only a check between the list and the prune stops the stale file going.
    const node = dirNode({}, { signal: controller.signal })
    node.list = async () => { controller.abort(); return { exists: true, entries: [], truncated: false } }
    await expect(mirrorNodeDirectory('s1', 'agent/app', node)).rejects.toMatchObject({ code: 'aborted' })
    expect(existsSync(stale)).toBe(true)
  })

  it('serialises overlapping directory mirrors so their list-fetch-prune cannot interleave', async () => {
    // X8: two mirrors of one directory that interleaved would let one's stale
    // listing prune what the other just brought down. The observable contract
    // is that their critical sections never overlap.
    mkdirSync(join(root, 'sync', 's1', 'agent', 'app'), { recursive: true })
    let active = 0
    let maxActive = 0
    const node = dirNode({ 'agent/app/a.txt': Buffer.from('a') })
    const realList = node.list
    node.list = async (input) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      const res = await realList(input)
      active--
      return res
    }
    await Promise.all([mirrorNodeDirectory('s1', 'agent/app', node), mirrorNodeDirectory('s1', 'agent/app', node)])
    expect(maxActive).toBe(1)
  })
})

describe('node directory mirror — combination scenarios (round 8 follow-up)', () => {
  function dirNode(files: Record<string, Buffer>, opts: { pending?: Set<string>; signal?: AbortSignal; onGet?: (rel: string) => void } = {}) {
    return {
      connectionId: 'conn-1',
      signal: opts.signal,
      isPendingUpload: (_s: string, rel: string) => opts.pending?.has(rel) ?? false,
      stat: async ({ relativePath }: { relativePath: string }) => {
        const f = files[relativePath]
        return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
      },
      get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
        opts.onGet?.(req.relativePath)
        const f = files[req.relativePath]!
        const slice = f.subarray(req.offset, req.offset + req.maxBytes)
        return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
      },
      list: async ({ relativePath }: { relativePath: string }) => {
        const entries = Object.keys(files)
          .filter((rel) => rel.startsWith(relativePath + '/'))
          .map((rel) => ({ relativePath: rel, size: files[rel]!.length, mtimeMs: 1_700_000_000_000 }))
        return { exists: entries.length > 0, entries, truncated: false }
      },
    }
  }

  it('Y1: refuses to fetch a member through an in-zone ancestor symlink that leaves the zone, leaving the target untouched', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mirror-y1-'))
    const target = join(outside, 'target')
    writeFileSync(target, 'not ours')
    mkdirSync(join(root, 'sync', 's1', 'agent', 'app'), { recursive: true })
    const { symlinkSync } = await import('node:fs')
    symlinkSync(outside, join(root, 'sync', 's1', 'agent', 'app', 'sub'))
    try {
      const node = dirNode({ 'agent/app/sub/target': Buffer.from('new bytes') })
      const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
      expect(outcome.kind).toBe('unavailable')
      expect(readFileSync(target, 'utf8')).toBe('not ours')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('Y3: refuses when reconciling a type swap would delete a desktop original still pending upload', async () => {
    // Desktop app/foo/original is the only copy, queued for upload; node made foo a file.
    const original = join(root, 'sync', 's1', 'agent', 'app', 'foo', 'original')
    mkdirSync(join(original, '..'), { recursive: true })
    writeFileSync(original, 'unsent desktop bytes')
    const node = dirNode({ 'agent/app/foo': Buffer.from('now a file') }, { pending: new Set(['agent/app/foo/original']) })
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(outcome.kind).toBe('unavailable')
    expect(readFileSync(original, 'utf8')).toBe('unsent desktop bytes')
  })

  it('Y6: a failed batch does not resolve until every worker it started has settled', async () => {
    // A lists a,b: a is refused, b get is gated. If A resolves the moment a
    // fails, its b worker outlives the mirror and can write into whatever a
    // later mirror of this directory produced. A must drain first — so it must
    // not settle while b is still in flight.
    let releaseB: () => void = () => {}
    const gateB = new Promise<void>((r) => { releaseB = r })
    const nodeA = dirNode({ 'agent/app/a.txt': Buffer.from('a'), 'agent/app/b.txt': Buffer.from('b') })
    const realStatA = nodeA.stat
    nodeA.stat = async (input) => { if (input.relativePath === 'agent/app/a.txt') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); return realStatA(input) }
    let bStarted = false
    const realGetA = nodeA.get
    nodeA.get = async (req) => { if (req.relativePath === 'agent/app/b.txt') { bStarted = true; await gateB } return realGetA(req) }

    const a = mirrorNodeDirectory('s1', 'agent/app', nodeA)
    await vi.waitFor(() => expect(bStarted).toBe(true))
    let settled = false
    void a.then(() => { settled = true }, () => { settled = true })
    // Let every pending microtask flush; A must still be holding for b.
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    releaseB()
    const outcomeA = await a
    expect(outcomeA.kind).toBe('unavailable')
  })

  it('Y2: removes a stale mirror file as a link when it points out of the zone, never following it to delete the target', async () => {
    // A prune must delete a leftover it finds, but a link a producer planted in
    // the mirror is removed as the link — its target is not the mirror\'s.
    const outside = mkdtempSync(join(tmpdir(), 'mirror-y2-'))
    const target = join(outside, 'target')
    writeFileSync(target, 'not ours')
    mkdirSync(join(root, 'sync', 's1', 'agent', 'app'), { recursive: true })
    const { symlinkSync } = await import('node:fs')
    symlinkSync(target, join(root, 'sync', 's1', 'agent', 'app', 'stale-link'))
    try {
      const node = dirNode({ 'agent/app/manifest.json': Buffer.from('{}') })
      await mirrorNodeDirectory('s1', 'agent/app', node)
      expect(existsSync(join(root, 'sync', 's1', 'agent', 'app', 'stale-link'))).toBe(false)
      expect(readFileSync(target, 'utf8')).toBe('not ours')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('Y7B: does not prune when the mirror is cancelled between the last fetch and the prune', async () => {
    const stale = join(root, 'sync', 's1', 'agent', 'app', 'prior.txt')
    mkdirSync(join(stale, '..'), { recursive: true })
    writeFileSync(stale, 'prior')
    const controller = new AbortController()
    const node = dirNode({ 'agent/app/keep.txt': Buffer.from('k') }, { signal: controller.signal })
    // Cancel the moment the one member finishes fetching, before the prune runs.
    const realGet = node.get
    node.get = async (req) => { const r = await realGet(req); controller.abort(); return r }
    await expect(mirrorNodeDirectory('s1', 'agent/app', node)).rejects.toMatchObject({ code: 'aborted' })
    expect(existsSync(stale)).toBe(true)
  })

  it('Y7A: does not delete the old directory when the single-file mirror is cancelled during its stat', async () => {
    // foo is a desktop directory; node made it a file; the action cancels while
    // the stat is in flight. Reconcile must not remove foo before the abort lands.
    const asDir = join(root, 'sync', 's1', 'agent', 'foo')
    mkdirSync(join(asDir, 'child'), { recursive: true })
    writeFileSync(join(asDir, 'child', 'x'), 'keep me')
    const controller = new AbortController()
    const node = {
      connectionId: 'conn-1',
      signal: controller.signal,
      isPendingUpload: () => false,
      stat: async () => { controller.abort(); return { exists: true, size: 3, mtimeMs: 1 } },
      get: async () => ({ chunk: Buffer.from('abc').toString('base64'), total: 3, mtimeMs: 1, eof: true }),
    }
    await expect(mirrorNodeArtifact('s1', 'agent/foo', node)).rejects.toMatchObject({ code: 'aborted' })
    expect(existsSync(join(asDir, 'child', 'x'))).toBe(true)
  })
})

describe('node mirror — pending originals read at the moment of writing (round 9 follow-up)', () => {
  /** A node whose pending set is the real job table, never an injected predicate. */

  it('Z1: keeps an original another producer queued while a member of the same directory was downloading', async () => {
    // The prune must read the job table when it deletes, not from a snapshot
    // taken before the first fetch — a capture queued in between is the only copy.
    const newPath = join(root, 'sync', 's1', 'agent', 'app', 'new.png')
    const node = liveNode({ 'agent/app/old.txt': Buffer.from('old') }, {
      onGet: async () => {
        // Another Host Action produces and enqueues while this get is in flight.
        mkdirSync(join(newPath, '..'), { recursive: true })
        writeFileSync(newPath, 'fresh capture')
        state.jobs.push({ sessionId: 's1', relativePath: 'agent/app/new.png', state: 'pending' })
      },
    })
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', node)
    expect(outcome.kind).toBe('local')
    expect(existsSync(newPath)).toBe(true)
  })

  it('Z2A: serves a desktop original still owed to the node instead of overwriting it with the node’s older copy', async () => {
    const path = join(root, 'sync', 's1', 'media-gen', 'g.preview.jpg')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'NEW-desktop-bytes')
    state.jobs.push({ sessionId: 's1', relativePath: 'media-gen/g.preview.jpg', state: 'pending' })
    // The node still has the old version at the same path, different mtime.
    const node = liveNode({ 'media-gen/g.preview.jpg': Buffer.from('old') })
    const outcome = await mirrorNodeArtifact('s1', 'media-gen/g.preview.jpg', node)
    expect(outcome).toMatchObject({ kind: 'local', path })
    expect(readFileSync(path, 'utf8')).toBe('NEW-desktop-bytes')
  })

  it('Z2B: refuses to commit a fetch over an original that was produced and queued while it was downloading', async () => {
    const path = join(root, 'sync', 's1', 'browser', 'shot.png')
    const node = liveNode({ 'browser/shot.png': Buffer.from('node-old') }, {
      onGet: async () => {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, 'NEW-desktop-bytes')
        state.jobs.push({ sessionId: 's1', relativePath: 'browser/shot.png', state: 'pending' })
      },
    })
    const outcome = await mirrorNodeArtifact('s1', 'browser/shot.png', node)
    expect(outcome.kind).toBe('unavailable')
    expect(readFileSync(path, 'utf8')).toBe('NEW-desktop-bytes')
  })

  it('Z3: never serves a cached or offline copy that resolves outside the session zone', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mirror-z3-'))
    const secret = join(outside, 'TOP')
    writeFileSync(secret, 'not ours')
    mkdirSync(join(root, 'sync', 's1', 'agent'), { recursive: true })
    const { symlinkSync } = await import('node:fs')
    symlinkSync(secret, join(root, 'sync', 's1', 'agent', 'link'))
    try {
      const size = statSync(secret).size
      const mtimeMs = Math.floor(statSync(secret).mtimeMs)
      // Cache hit: the node reports exactly what the link's target looks like.
      const matching = { connectionId: 'c', stat: async () => ({ exists: true, size, mtimeMs }), get: async () => { throw new Error('must not fetch') } }
      expect((await mirrorNodeArtifact('s1', 'agent/link', matching)).kind).toBe('unavailable')
      // Offline: the node cannot be reached, so the local copy would be served.
      const offline = { connectionId: 'c', stat: async () => { throw new Error('not connected') }, get: async () => { throw new Error('not connected') } }
      expect((await mirrorNodeArtifact('s1', 'agent/link', offline)).kind).toBe('unavailable')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('Z4: stops before touching anything when the cancel lands while the pending set is being read', async () => {
    const asDir = join(root, 'sync', 's1', 'agent', 'app', 'foo')
    mkdirSync(join(asDir, 'keep'), { recursive: true })
    writeFileSync(join(asDir, 'keep', 'x'), 'keep me')
    const controller = new AbortController()
    const node = liveNode({ 'agent/app/foo': Buffer.from('now a file') })
    const realList = node.list
    // Cancel lands after the listing, during the pending-set read that follows it.
    node.list = async (input) => { const r = await realList(input); queueMicrotask(() => queueMicrotask(() => controller.abort())); return r }
    await expect(mirrorNodeDirectory('s1', 'agent/app', { ...node, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(existsSync(join(asDir, 'keep', 'x'))).toBe(true)
  })
})

describe('node mirror — files a producer is still writing (round 11 follow-up)', () => {
  it('AA1: keeps a download whose path is reserved but whose bytes and job do not exist yet', async () => {
    // The gap the job table cannot cover: `browser_download` reserved the path
    // and is streaming into it. There is no transfer job until the file is
    // sealed, so to the prune the file looks like a stale mirror member.
    const inProgress = join(root, 'sync', 's1', 'agent', 'app', 'new.txt')
    mkdirSync(join(inProgress, '..'), { recursive: true })
    writeFileSync(inProgress, 'FIRST')
    beginActiveWrite('s1', inProgress)
    const outcome = await mirrorNodeDirectory('s1', 'agent/app', liveNode({ 'agent/app/old.txt': Buffer.from('old') }))
    expect(outcome.kind).toBe('local')
    expect(existsSync(inProgress)).toBe(true)
    expect(readFileSync(inProgress, 'utf8')).toBe('FIRST')
  })

  it('AA1: refuses to commit a fetch over a file a producer started writing while it downloaded', async () => {
    const path = join(root, 'sync', 's1', 'browser', 'shot.png')
    const node = liveNode({ 'browser/shot.png': Buffer.from('node-old') }, {
      onGet: async () => {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, 'PARTIAL-desktop-bytes')
        beginActiveWrite('s1', path)
      },
    })
    const outcome = await mirrorNodeArtifact('s1', 'browser/shot.png', node)
    expect(outcome.kind).toBe('unavailable')
    expect(readFileSync(path, 'utf8')).toBe('PARTIAL-desktop-bytes')
  })

  it('AA1: does not reconcile a directory away when a producer is writing inside it', async () => {
    // The node now has `agent/app` as a FILE; reconciling would rm the desktop
    // directory — taking the half-written download with it.
    const inProgress = join(root, 'sync', 's1', 'agent', 'app', 'new.txt')
    mkdirSync(join(inProgress, '..'), { recursive: true })
    writeFileSync(inProgress, 'FIRST')
    beginActiveWrite('s1', inProgress)
    const outcome = await mirrorNodeArtifact('s1', 'agent/app', liveNode({ 'agent/app': Buffer.from('now a file') }))
    expect(outcome.kind).toBe('unavailable')
    expect(readFileSync(inProgress, 'utf8')).toBe('FIRST')
  })

  it('AA1: stops protecting the file once the write is handed off', async () => {
    const stale = join(root, 'sync', 's1', 'agent', 'app', 'new.txt')
    mkdirSync(join(stale, '..'), { recursive: true })
    writeFileSync(stale, 'FIRST')
    beginActiveWrite('s1', stale)
    endActiveWrite('s1', stale)
    await mirrorNodeDirectory('s1', 'agent/app', liveNode({ 'agent/app/old.txt': Buffer.from('old') }))
    expect(existsSync(stale)).toBe(false)
  })

  it('AA2: refreshes from the node when the only outstanding work on the original is its completion notice', async () => {
    // `uploaded` / `notifying` mean the bytes are already on the node; the job
    // is waiting on an ACK. Treating that as "the node still owes us" served a
    // stale local copy over a newer file the agent had written on the node.
    const path = join(root, 'sync', 's1', 'media-gen', 'g.png')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'OLD')
    for (const jobState of ['uploaded', 'notifying']) {
      state.jobs = [{ sessionId: 's1', relativePath: 'media-gen/g.png', state: jobState }]
      writeFileSync(path, 'OLD')
      const outcome = await mirrorNodeArtifact('s1', 'media-gen/g.png', liveNode({ 'media-gen/g.png': Buffer.from('NEW-from-node') }))
      expect(outcome.kind, jobState).toBe('local')
      expect(readFileSync(path, 'utf8'), jobState).toBe('NEW-from-node')
    }
  })

  it('AA2: still protects an original whose upload failed and has not been retried', async () => {
    const path = join(root, 'sync', 's1', 'media-gen', 'g.png')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'DESKTOP-ONLY')
    state.jobs = [{ sessionId: 's1', relativePath: 'media-gen/g.png', state: 'failed' }]
    const outcome = await mirrorNodeArtifact('s1', 'media-gen/g.png', liveNode({ 'media-gen/g.png': Buffer.from('node-old') }))
    expect(outcome).toMatchObject({ kind: 'local' })
    expect(readFileSync(path, 'utf8')).toBe('DESKTOP-ONLY')
  })
})
