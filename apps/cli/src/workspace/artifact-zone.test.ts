import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARTIFACT_CHUNK_BYTES } from '@superone/shared/environment'
import { ArtifactZoneService } from './artifact-zone'

let root: string
let zone: ArtifactZoneService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'superone-artifact-zone-'))
  zone = new ArtifactZoneService(join(root, 'sync'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code
  }
  return undefined
}

/** Upload `data` as ordered chunks of `chunkSize`, the way the desktop does. */
function upload(sessionId: string, relativePath: string, data: Buffer, transferId = 't1', chunkSize = 3) {
  const digest = sha(data)
  if (data.length === 0) {
    return zone.put({ sessionId, relativePath, transferId, offset: 0, total: 0, sha256: digest, chunk: '', final: true })
  }
  let result
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize)
    result = zone.put({
      sessionId, relativePath, transferId, offset, total: data.length, sha256: digest,
      chunk: chunk.toString('base64'), final: offset + chunk.length >= data.length,
    })
  }
  return result!
}

describe('artifact zone scoping', () => {
  it('rejects traversal, absolute paths, cross-session ids and the session directory itself', () => {
    expect(code(() => zone.stat('s1', '../s2/browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', '/etc/passwd'))).toBe('invalid_argument')
    expect(code(() => zone.stat('../s2', 'browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1/../s2', 'browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', '.'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', 'browser/..'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', ''))).toBe('invalid_argument')
  })

  it('refuses the session .owner marker through stat, get and put, since it is not an artifact', () => {
    // The desktop mirror must never fetch the node's `.owner` over its own —
    // that would move the directory's ownership and hand a live session to the
    // reclaim sweep.
    expect(code(() => zone.resolve('s1', '.owner'))).toBe('invalid_argument')
    expect(code(() => zone.resolve('s1', './.owner'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', '.owner'))).toBe('invalid_argument')
  })

  it('refuses a symlink that escapes the session directory', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    mkdirSync(join(root, 'sync', 's1'), { recursive: true })
    symlinkSync(outside, join(root, 'sync', 's1', 'link'))
    expect(code(() => zone.stat('s1', 'link/secret.txt'))).toBe('invalid_argument')
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'link/secret.txt', offset: 0, maxBytes: 10 }))).toBe('invalid_argument')
  })

  it('refuses a session directory that is itself a symlink to another session', () => {
    // The authorisation boundary is <syncRoot>/<sessionId>; realpath-ing that
    // directory before checking would let s1 read and write s2 through a link.
    mkdirSync(join(root, 'sync', 's2', 'agent'), { recursive: true })
    writeFileSync(join(root, 'sync', 's2', 'agent', 'secret.txt'), 'other session')
    symlinkSync(join(root, 'sync', 's2'), join(root, 'sync', 's1'))
    expect(code(() => zone.stat('s1', 'agent/secret.txt'))).toBe('invalid_argument')
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'agent/secret.txt', offset: 0, maxBytes: 64 }))).toBe('invalid_argument')
    expect(code(() => upload('s1', 'agent/secret.txt', Buffer.from('overwritten')))).toBe('invalid_argument')
    expect(readFileSync(join(root, 'sync', 's2', 'agent', 'secret.txt'), 'utf8')).toBe('other session')
  })

  it('reports a missing artifact as exists:false rather than an error', () => {
    expect(zone.stat('s1', 'browser/nothing.png')).toEqual({ exists: false, size: 0, mtimeMs: 0 })
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'browser/nothing.png', offset: 0, maxBytes: 10 }))).toBe('not_found')
  })
})

describe('artifact upload', () => {
  it('writes ordered chunks into staging and renames into place only on the verified final chunk', () => {
    const data = Buffer.from('hello sync zone')
    const digest = sha(data)
    const first = zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: digest, chunk: data.subarray(0, 5).toString('base64'), final: false })
    expect(first).toEqual({ ok: true, bytesWritten: 5 })
    const dir = join(root, 'sync', 's1', 'browser')
    expect(readdirSync(dir)).toEqual([])
    expect(readdirSync(join(root, 'sync', 's1', '.parts'))).toEqual(['t1'])
    expect(zone.stat('s1', 'browser/a.png').exists).toBe(false)

    const last = zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 5, total: data.length, sha256: digest, chunk: data.subarray(5).toString('base64'), final: true })
    expect(last).toMatchObject({ ok: true, bytesWritten: data.length })
    expect(last.mtimeMs).toBe(zone.stat('s1', 'browser/a.png').mtimeMs)
    expect(readdirSync(dir)).toEqual(['a.png'])
    expect(readFileSync(join(dir, 'a.png'))).toEqual(data)
    expect(zone.stat('s1', 'browser/a.png')).toMatchObject({ exists: true, size: data.length })
    expect(zone.activeTransfers()).toEqual([])
  })

  it('resumes from the offset the node reports after a gap, and ignores a repeated chunk', () => {
    const data = Buffer.from('abcdefghij')
    const digest = sha(data)
    const put = (offset: number, end: number, final = false) => zone.put({
      sessionId: 's1', relativePath: 'agent/r.md', transferId: 't1', offset, total: data.length, sha256: digest,
      chunk: data.subarray(offset, end).toString('base64'), final,
    })
    put(0, 4)
    const gap = (() => {
      try { put(6, 8) } catch (err) { return err as { code?: string; details?: { expectedOffset?: number } } }
      return null
    })()
    expect(gap?.code).toBe('conflict')
    expect(gap?.details?.expectedOffset).toBe(4)
    // A retry of the chunk the node already has is acknowledged, not appended twice.
    expect(put(0, 4)).toEqual({ ok: true, bytesWritten: 4 })
    put(4, 8)
    expect(put(8, 10, true)).toMatchObject({ ok: true, bytesWritten: 10 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'r.md'))).toEqual(data)
  })

  it('answers busy to a second transfer for a path that is still being written', () => {
    const data = Buffer.from('xxxxxxxx')
    zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: 8, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false })
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't2', offset: 0, total: 8, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false }))).toBe('busy')
    // The same path in another session is a different file.
    expect(zone.put({ sessionId: 's2', relativePath: 'browser/a.png', transferId: 't3', offset: 0, total: 8, sha256: sha(data), chunk: data.toString('base64'), final: true }).ok).toBe(true)
  })

  it('lets a new transfer take over a path whose previous transfer went idle', () => {
    // The desktop lost its connection after the first chunk; the deferred job
    // that retries later carries a new transferId and must not be told busy
    // until the node restarts.
    const data = Buffer.from('abcdef')
    zone.put({ sessionId: 's1', relativePath: 'recording/a.mp4', transferId: 'eager', offset: 0, total: 6, sha256: sha(data), chunk: data.subarray(0, 3).toString('base64'), final: false })
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'recording/a.mp4', transferId: 'job', offset: 0, total: 6, sha256: sha(data), chunk: data.subarray(0, 3).toString('base64'), final: false }))).toBe('busy')
    zone.expireIdleTransfers(Date.now() + zone.idleTransferTtlMs + 1)
    expect(zone.activeTransfers()).toEqual([])
    expect(upload('s1', 'recording/a.mp4', data, 'job')).toMatchObject({ ok: true, bytesWritten: 6 })
    expect(readFileSync(join(root, 'sync', 's1', 'recording', 'a.mp4'))).toEqual(data)
  })

  it('drops the part file and the transfer when the digest does not match', () => {
    const data = Buffer.from('payload')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: sha(Buffer.from('other')), chunk: data.toString('base64'), final: true }))).toBe('invalid_argument')
    expect(existsSync(join(root, 'sync', 's1', 'browser', 'a.png'))).toBe(false)
    expect(readdirSync(join(root, 'sync', 's1', 'browser'))).toEqual([])
    expect(zone.activeTransfers()).toEqual([])
  })

  it('stages bytes in a reserved directory the RPC cannot name, and leaves a real file with a part-like name alone', () => {
    const dir = join(root, 'sync', 's1', 'browser')
    mkdirSync(dir, { recursive: true })
    // A legitimate artifact whose name happens to look like staging.
    upload('s1', 'browser/a.png.part.keep', Buffer.from('mine'), 'keep')
    zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 'open', offset: 0, total: 6, sha256: sha(Buffer.from('freshy')), chunk: Buffer.from('fre').toString('base64'), final: false })
    expect(readdirSync(dir).sort()).toEqual(['a.png.part.keep'])
    expect(readdirSync(join(root, 'sync', 's1', '.parts'))).toEqual(['open'])
    // Neither reading nor writing the staging area is allowed through the contract.
    expect(code(() => zone.get({ sessionId: 's1', relativePath: '.parts/open', offset: 0, maxBytes: 16 }))).toBe('invalid_argument')
    expect(code(() => upload('s1', '.parts/x', Buffer.from('y'), 'x'))).toBe('invalid_argument')
    upload('s1', 'browser/a.png', Buffer.from('freshy'), 'open')
    expect(readdirSync(dir).sort()).toEqual(['a.png', 'a.png.part.keep'])
    expect(readFileSync(join(dir, 'a.png.part.keep'), 'utf8')).toBe('mine')
  })

  it('refuses a relative path that normalises into the staging area', () => {
    // The reserved check has to run on the resolved path, not the spelling:
    // `agent/../.parts/x` is `.parts/x`.
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'agent/../.parts/open', offset: 0, maxBytes: 16 }))).toBe('invalid_argument')
    expect(code(() => upload('s1', 'agent/../.parts/x', Buffer.from('y'), 'x'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', './.parts/open'))).toBe('invalid_argument')
  })

  it('refuses to stage through a symlinked .parts directory', () => {
    // `mkdir -p` happily accepts a link, and `openSync(..., 'wx')` only
    // protects the leaf — so without this the bytes land outside the zone.
    const outside = join(root, 'outside')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'victim'), 'not ours')
    mkdirSync(join(root, 'sync', 's1'), { recursive: true })
    symlinkSync(outside, join(root, 'sync', 's1', '.parts'))
    expect(code(() => upload('s1', 'browser/a.png', Buffer.from('bytes'), 'victim'))).toBe('failed_precondition')
    expect(readFileSync(join(outside, 'victim'), 'utf8')).toBe('not ours')
  })

  it('sweeps staging left by a crashed upload once it is old enough', () => {
    const parts = join(root, 'sync', 's1', '.parts')
    mkdirSync(parts, { recursive: true })
    writeFileSync(join(parts, 'dead'), 'half')
    const old = (Date.now() - zone.idleTransferTtlMs - 60_000) / 1000
    utimesSync(join(parts, 'dead'), old, old)
    upload('s1', 'browser/a.png', Buffer.from('fresh'))
    expect(readdirSync(parts)).toEqual([])
  })

  it('refuses to continue a transfer whose declared file changed under it', () => {
    // A deferred retry re-reads the local file; if it changed, the same
    // transferId now describes different bytes. Acknowledging that as the same
    // upload reports success for a file that was never written.
    const a = Buffer.from('AB')
    zone.put({ sessionId: 's1', relativePath: 'agent/a.txt', transferId: 'T', offset: 0, total: 2, sha256: sha(a), chunk: Buffer.from('A').toString('base64'), final: false })
    const c = Buffer.from('C')
    expect(code(() => zone.put({
      sessionId: 's1', relativePath: 'agent/a.txt', transferId: 'T', offset: 0, total: 1, sha256: sha(c), chunk: c.toString('base64'), final: true,
    }))).toBe('conflict')
    expect(zone.stat('s1', 'agent/a.txt').exists).toBe(false)
  })

  it('acknowledges a re-sent final chunk after the receipt was lost, without rewriting a newer version', () => {
    // The desktop never saw the reply to A's final chunk and re-sends it after
    // B replaced the file; a transfer forgotten on completion would treat that
    // as a fresh upload and roll the file back.
    const a = Buffer.from('old')
    const b = Buffer.from('new')
    upload('s1', 'agent/doc.txt', a, 'A')
    upload('s1', 'agent/doc.txt', b, 'B')
    const again = zone.put({ sessionId: 's1', relativePath: 'agent/doc.txt', transferId: 'A', offset: 0, total: 3, sha256: sha(a), chunk: a.toString('base64'), final: true })
    expect(again).toMatchObject({ ok: true, bytesWritten: 3 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'doc.txt'), 'utf8')).toBe('new')
  })

  it('stores an empty file as a single final chunk of zero bytes', () => {
    expect(upload('s1', 'agent/empty.txt', Buffer.alloc(0))).toMatchObject({ ok: true, bytesWritten: 0 })
    expect(zone.stat('s1', 'agent/empty.txt')).toMatchObject({ exists: true, size: 0 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'empty.txt'))).toHaveLength(0)
  })

  it('rejects a chunk larger than the contract size and an unknown transfer that does not start at 0', () => {
    const big = randomBytes(ARTIFACT_CHUNK_BYTES + 1)
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'a', transferId: 't1', offset: 0, total: big.length, sha256: sha(big), chunk: big.toString('base64'), final: true }))).toBe('invalid_argument')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'a', transferId: 't9', offset: 3, total: 8, sha256: sha(big), chunk: '', final: false }))).toBe('conflict')
  })

  it('replaces a completed file when the desktop re-uploads the same path', () => {
    upload('s1', 'media-gen/g-0.preview.jpg', Buffer.from('v1'), 't1')
    upload('s1', 'media-gen/g-0.preview.jpg', Buffer.from('v2-longer'), 't2')
    expect(readFileSync(join(root, 'sync', 's1', 'media-gen', 'g-0.preview.jpg'), 'utf8')).toBe('v2-longer')
  })
})

describe('artifact download', () => {
  it('streams a file in bounded windows with total, mtime and eof', () => {
    const data = Buffer.from('0123456789')
    upload('s1', 'agent/report.md', data)
    const a = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 0, maxBytes: 4 })
    expect(Buffer.from(a.chunk, 'base64').toString()).toBe('0123')
    expect(a).toMatchObject({ total: 10, eof: false })
    expect(a.mtimeMs).toBe(zone.stat('s1', 'agent/report.md').mtimeMs)
    const b = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 4, maxBytes: 100 })
    expect(Buffer.from(b.chunk, 'base64').toString()).toBe('456789')
    expect(b.eof).toBe(true)
    const past = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 10, maxBytes: 4 })
    expect(past).toMatchObject({ chunk: '', eof: true, total: 10 })
  })
})

describe('artifact delete', () => {
  it('removes one file or the whole session directory', async () => {
    upload('s1', 'browser/a.png', Buffer.from('a'), 't1')
    upload('s1', 'browser/b.png', Buffer.from('b'), 't2')
    await zone.delete('s1', 'browser/a.png')
    expect(readdirSync(join(root, 'sync', 's1', 'browser'))).toEqual(['b.png'])
    await zone.delete('s1')
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    // Deleting what is already gone is fine.
    await zone.delete('s1')
  })

  it('tombstones the session so a chunk arriving mid-delete cannot recreate the directory', async () => {
    const data = Buffer.from('late-arrival')
    zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false })
    const deleting = zone.delete('s1')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 4, total: data.length, sha256: sha(data), chunk: data.subarray(4).toString('base64'), final: true }))).toBe('failed_precondition')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/c.png', transferId: 't2', offset: 0, total: 1, sha256: sha(Buffer.from('c')), chunk: Buffer.from('c').toString('base64'), final: true }))).toBe('failed_precondition')
    await deleting
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    expect(zone.activeTransfers()).toEqual([])
    // Once the delete has returned, the session can be written again.
    upload('s1', 'browser/c.png', Buffer.from('c'), 't3')
    expect(zone.stat('s1', 'browser/c.png').exists).toBe(true)
  })
})

describe('artifact directory listing', () => {
  it('lists the files under a directory recursively, with the size and mtime the mirror compares', () => {
    // A directory argument to a tool has no single file to stat; the desktop
    // needs every member to mirror it and the same version signal per file.
    upload('s1', 'agent/app/manifest.json', Buffer.from('{}'))
    upload('s1', 'agent/app/src/index.js', Buffer.from('export {}'), 't2')
    upload('s1', 'agent/other.txt', Buffer.from('x'), 't3')
    const listing = zone.list('s1', 'agent/app')
    expect(listing.exists).toBe(true)
    expect(listing.truncated).toBe(false)
    expect(listing.entries.map((e) => e.relativePath).sort()).toEqual(['agent/app/manifest.json', 'agent/app/src/index.js'])
    const manifest = listing.entries.find((e) => e.relativePath === 'agent/app/manifest.json')!
    const stat = zone.stat('s1', 'agent/app/manifest.json')
    expect(manifest).toEqual({ relativePath: 'agent/app/manifest.json', size: stat.size, mtimeMs: stat.mtimeMs })
  })

  it('reports a missing directory as exists:false, and a file as not a directory', () => {
    expect(zone.list('s1', 'agent/none')).toEqual({ exists: false, entries: [], truncated: false })
    upload('s1', 'agent/file.txt', Buffer.from('x'))
    expect(zone.list('s1', 'agent/file.txt').exists).toBe(false)
  })

  it('never lists through a symlink, the staging area or the owner marker', () => {
    // The listing feeds `get`, which is scoped; but a link inside the tree
    // would still expose *names* from outside the zone, and the reserved
    // areas are not artifacts.
    upload('s1', 'agent/app/a.txt', Buffer.from('a'))
    const outside = mkdtempSync(join(tmpdir(), 'zone-outside-'))
    try {
      writeFileSync(join(outside, 'secret.txt'), 's')
      symlinkSync(outside, join(root, 'sync', 's1', 'agent', 'app', 'linked'))
      mkdirSync(join(root, 'sync', 's1', 'agent', 'app', '.parts'), { recursive: true })
      writeFileSync(join(root, 'sync', 's1', 'agent', 'app', '.parts', 'stage'), 'p')
      writeFileSync(join(root, 'sync', 's1', '.owner'), 'local')
      expect(zone.list('s1', 'agent/app').entries.map((e) => e.relativePath)).toEqual(['agent/app/a.txt'])
      expect(zone.list('s1', 'agent').entries.map((e) => e.relativePath)).toEqual(['agent/app/a.txt'])
      // The linked directory itself is refused as a listing root.
      expect(code(() => zone.list('s1', 'agent/app/linked'))).toBe('invalid_argument')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('refuses a linked directory inside the session as a root, instead of listing its target under the wrong name', () => {
    // `agent/alias -> agent/actual` is inside the zone, so it is not an
    // escape — but a listing of `alias` that names `actual/...` sends the
    // desktop to fetch one path and hand the tool another. The contract is
    // "no directory link is followed", including the one asked for.
    upload('s1', 'agent/actual/manifest.json', Buffer.from('{}'))
    symlinkSync(join(root, 'sync', 's1', 'agent', 'actual'), join(root, 'sync', 's1', 'agent', 'alias'))
    expect(code(() => zone.list('s1', 'agent/alias'))).toBe('invalid_argument')
    expect(code(() => zone.list('s1', 'agent/alias/sub'))).toBe('invalid_argument')
    for (const e of zone.list('s1', 'agent/actual').entries) expect(e.relativePath.startsWith('agent/actual/')).toBe(true)
  })

  it('reports a subtree it could not read as an error, never as a complete listing', () => {
    // The desktop prunes its mirror to what this listing names. An unreadable
    // subdirectory that came back as "nothing there" would have every file
    // under it deleted on the desktop and a tool run against a partial tree.
    upload('s1', 'agent/app/manifest.json', Buffer.from('{}'))
    upload('s1', 'agent/app/assets/logo.png', Buffer.from('png'), 't2')
    const assets = join(root, 'sync', 's1', 'agent', 'app', 'assets')
    chmodSync(assets, 0o000)
    try {
      expect(code(() => zone.list('s1', 'agent/app'))).toBe('unavailable')
    } finally {
      chmodSync(assets, 0o755)
    }
    expect(zone.list('s1', 'agent/app').entries.map((e) => e.relativePath).sort()).toEqual(['agent/app/assets/logo.png', 'agent/app/manifest.json'])
  })

  it('stops at the entry cap and says so, rather than handing over a partial tree as whole', () => {
    for (let i = 0; i < 5; i++) upload('s1', `agent/big/f${i}.txt`, Buffer.from('x'), `t${i}`)
    const listing = zone.list('s1', 'agent/big', 3)
    expect(listing.entries).toHaveLength(3)
    expect(listing.truncated).toBe(true)
  })
})
