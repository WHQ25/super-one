import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchRpc, type RpcContext } from '@superone/runtime/server'
import { TEMP_FILE_RPC_METHODS, type TempFileReadResult, type TempFileStatResult } from '@superone/shared/environment'
import { materializeRemoteTempFile, type RemoteTempFileSource } from './remote-temp-files'
import { resolveRemotePreviewerFile, type RemotePreviewerContext } from './files-previewer-remote'
import { resolveSessionFile, type SessionFileResolverDeps } from './session-file-resolver'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'remote-temp-test-'))
  dirs.push(dir)
  return dir
}
const ctx = { client: { clientSessionId: 'controller', scopes: ['workspace:read'] }, workspaceFs: {}, hooks: {} } as unknown as RpcContext
async function rpc<T>(method: string, payload: unknown): Promise<T> {
  const out = await dispatchRpc(method, payload, ctx)
  if (out.error) throw Object.assign(new Error(out.error.message), { code: out.error.code })
  return out.result as T
}
function source(): RemoteTempFileSource {
  return {
    stat: path => rpc<TempFileStatResult>(TEMP_FILE_RPC_METHODS.stat, { path }),
    read: input => rpc<TempFileReadResult>(TEMP_FILE_RPC_METHODS.read, input),
  }
}

describe('temporary file delivery from node RPC to desktop', () => {
  it('previews images, text and missing files with node identity and serves the same bytes to file readers', async () => {
    const dir = directory()
    const src = source()
    const resolveTempFile = (path: string) => materializeRemoteTempFile('node-a', path, src)
    const context: RemotePreviewerContext = {
      connectionId: 'node-a', hostPath: '/project', cwd: '/project', zone: null,
      artifactStat: async () => { throw new Error('not a session artifact') },
      artifactGet: async () => { throw new Error('not a session artifact') },
      listDir: async () => { throw new Error('not a project file') },
      resolveTempFile,
    }
    for (const [name, contents, kind] of [
      ['shot #1.png', Buffer.from([0x89, 0x50, 0, 0xff]), 'image'],
      ['report.txt', Buffer.from('临时文本'), 'text'],
      ['binary.txt', Buffer.from([0, 1, 2]), 'unpreviewable'],
    ] as const) {
      const path = join(dir, name)
      writeFileSync(path, contents)
      expect(await resolveRemotePreviewerFile({ path, note: 'result' }, context))
        .toMatchObject({ kind, absolutePath: path, path, name, note: 'result' })
      const deps: SessionFileResolverDeps = {
        getSyncZone: () => null,
        artifactStat: context.artifactStat,
        artifactGet: (_c, input) => context.artifactGet(input),
        resolveRemoteTempFile: (_c, path) => resolveTempFile(path),
      }
      const read = await resolveSessionFile('remote:node-a:/project', path, deps)
      expect(read.kind).toBe('local')
      if (read.kind === 'local') expect(readFileSync(read.path)).toEqual(contents)
    }
    expect(await resolveRemotePreviewerFile({ path: join(dir, 'missing.png') }, context)).toMatchObject({ kind: 'missing' })
    expect(await resolveRemotePreviewerFile({ path: '/etc/hosts' }, context))
      .toMatchObject({ kind: 'unpreviewable', reason: 'outside_readable_roots' })
  })

  it('copies exact bytes, reuses unchanged bytes and refreshes edited files', async () => {
    const path = join(directory(), 'report #1.png')
    const bytes = Buffer.from([0x89, 0x50, 0, 0xff])
    writeFileSync(path, bytes)
    const src = source()
    const read = vi.spyOn(src, 'read')
    const first = await materializeRemoteTempFile('node-a', path, src)
    expect(first.kind).toBe('local')
    if (first.kind !== 'local') throw new Error('expected a local copy')
    expect(readFileSync(first.path)).toEqual(bytes)
    await materializeRemoteTempFile('node-a', path, src)
    expect(read).toHaveBeenCalledTimes(1)
    writeFileSync(path, 'new contents')
    const next = await materializeRemoteTempFile('node-a', path, src)
    expect(next.kind).toBe('local')
    if (next.kind === 'local') expect(readFileSync(next.path, 'utf8')).toBe('new contents')
    expect(read).toHaveBeenCalledTimes(2)
    const other = await materializeRemoteTempFile('node-b', path, src)
    expect(other.kind === 'local' && other.path).not.toBe(first.path)
  })

  it('keeps outside-root and missing verdicts distinct and never reads refused files', async () => {
    const src = source()
    const read = vi.spyOn(src, 'read')
    expect(await materializeRemoteTempFile('node-a', '/etc/hosts', src)).toEqual({ kind: 'outside' })
    expect(await materializeRemoteTempFile('node-a', join(directory(), 'missing.txt'), src)).toEqual({ kind: 'missing' })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects changed or truncated transfers without publishing partial bytes', async () => {
    const src: RemoteTempFileSource = {
      stat: async () => ({ exists: true, size: 4, mtimeMs: 1 }),
      read: async () => ({ chunk: Buffer.from('bad').toString('base64'), total: 4, mtimeMs: 1, eof: true }),
    }
    await expect(materializeRemoteTempFile('node-a', '/tmp/broken.txt', src)).rejects.toThrow()
    src.read = async () => { throw new Error('disconnected') }
    await expect(materializeRemoteTempFile('node-a', '/tmp/broken.txt', src)).rejects.toThrow('disconnected')
  })

  it('refreshes sub-millisecond same-size changes and never serves a cached file after deletion or disconnection', async () => {
    const path = join(directory(), 'cache.txt')
    let bytes = Buffer.from('old')
    let mtimeMs = 1_700_000_000_000.1
    const src: RemoteTempFileSource = {
      stat: async () => ({ exists: true, size: bytes.length, mtimeMs }),
      read: async () => ({ chunk: bytes.toString('base64'), total: bytes.length, mtimeMs, eof: true }),
    }
    await materializeRemoteTempFile('node-a', path, src)
    bytes = Buffer.from('new')
    mtimeMs += 0.2
    const next = await materializeRemoteTempFile('node-a', path, src)
    if (next.kind !== 'local') throw new Error('expected a local copy')
    expect(readFileSync(next.path, 'utf8')).toBe('new')
    src.stat = async () => { throw new Error('disconnected') }
    await expect(materializeRemoteTempFile('node-a', path, src)).rejects.toThrow('disconnected')
    src.stat = async () => ({ exists: false, size: 0, mtimeMs: 0 })
    expect(await materializeRemoteTempFile('node-a', path, src)).toEqual({ kind: 'missing' })
  })
})
