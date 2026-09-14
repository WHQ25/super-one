import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { materializeRemoteProjectFile, resolveSessionFile, type SessionFileResolverDeps } from './session-file-resolver'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'resolver-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }

function deps(files: Record<string, Buffer>, hasZone = true): SessionFileResolverDeps {
  return {
    getSyncZone: () => (hasZone ? zone : null),
    artifactStat: async (_c, _s, rel) => {
      const f = files[rel]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    artifactGet: async (_c, req) => {
      const f = files[req.relativePath]
      const slice = f.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: req.offset + slice.length >= f.length }
    },
  }
}

describe('resolveSessionFile', () => {
  it('returns a local path as-is for a local root, joining relative paths against it', async () => {
    expect(await resolveSessionFile('/proj', 'src/a.ts')).toEqual({ kind: 'local', path: '/proj/src/a.ts' })
    expect(await resolveSessionFile('/proj', '/abs/b.png')).toEqual({ kind: 'local', path: '/abs/b.png' })
    expect(await resolveSessionFile(undefined, '/abs/b.png')).toEqual({ kind: 'local', path: '/abs/b.png' })
  })

  it('mirrors a node zone path to the desktop copy in a remote session', async () => {
    const d = deps({ 'agent/report.md': Buffer.from('# hi') })
    const out = await resolveSessionFile('remote:c1:/home/node/proj', '/home/node/.superone/node/sync/s1/agent/report.md', d)
    expect(out).toEqual({ kind: 'local', path: join(root, 'sync', 's1', 'agent', 'report.md') })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'report.md'), 'utf8')).toBe('# hi')
  })

  it('reports a node zone file that exists on neither side as missing', async () => {
    expect(await resolveSessionFile('remote:c1:/home/node/proj', '/home/node/.superone/node/sync/s1/agent/none.md', deps({})))
      .toEqual({ kind: 'missing' })
  })

  it('serves a desktop zone path referenced from a remote session locally', async () => {
    const local = join(root, 'sync', 's1', 'browser', 'shot.png')
    mkdirSync(join(root, 'sync', 's1', 'browser'), { recursive: true })
    writeFileSync(local, 'png')
    expect(await resolveSessionFile('remote:c1:/home/node/proj', local, deps({}))).toEqual({ kind: 'local', path: local })
  })

  it('treats a project path in a remote session as a node project file, relative to the project', async () => {
    const d = deps({})
    expect(await resolveSessionFile('remote:c1:/home/node/proj', '/home/node/proj/docs/a.md', d))
      .toEqual({ kind: 'remote-project', connectionId: 'c1', folderPath: 'remote:c1:/home/node/proj', relativePath: 'docs/a.md' })
    expect(await resolveSessionFile('remote:c1:/home/node/proj', 'docs/a.md', d))
      .toEqual({ kind: 'remote-project', connectionId: 'c1', folderPath: 'remote:c1:/home/node/proj', relativePath: 'docs/a.md' })
  })

  it('never splices an absolute node path outside the project into it', async () => {
    // `/etc/hosts` is not `<project>/etc/hosts`; showing that file would be a lie.
    expect(await resolveSessionFile('remote:c1:/home/node/proj', '/etc/hosts', deps({}))).toEqual({ kind: 'missing' })
    expect(await resolveSessionFile('remote:c1:/home/node/proj', '/home/node/proj-other/a.md', deps({}))).toEqual({ kind: 'missing' })
    // An older node has no zone: a zone-shaped path is just an absolute path outside the project.
    expect(await resolveSessionFile('remote:c1:/home/node/proj', '/home/node/.superone/node/sync/s1/agent/x.md', deps({ 'agent/x.md': Buffer.from('x') }, false)))
      .toEqual({ kind: 'missing' })
  })
})

describe('materializeRemoteProjectFile', () => {
  it('stages a node project file locally and reuses it while size and mtime match', async () => {
    let reads = 0
    let mtimeMs = 1_600_000_000_000
    const source = {
      stat: async () => ({ size: 5, mtimeMs }),
      read: async () => { reads++; return Buffer.from('hello') },
    }
    const a = await materializeRemoteProjectFile('c1', 'remote:c1:/proj', 'docs/a.md', source)
    expect(a).toBeTruthy()
    expect(readFileSync(a!, 'utf8')).toBe('hello')
    expect(Math.floor(statSync(a!).mtimeMs)).toBe(mtimeMs)
    await materializeRemoteProjectFile('c1', 'remote:c1:/proj', 'docs/a.md', source)
    expect(reads).toBe(1)
    mtimeMs += 1000
    await materializeRemoteProjectFile('c1', 'remote:c1:/proj', 'docs/a.md', source)
    expect(reads).toBe(2)
    rmSync(join(a!, '..', '..'), { recursive: true, force: true })
  })

  it('returns null for a file the node does not have', async () => {
    expect(await materializeRemoteProjectFile('c1', 'remote:c1:/proj', 'nope.md', { stat: async () => null, read: async () => Buffer.alloc(0) })).toBeNull()
  })
})
