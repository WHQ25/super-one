import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEMP_FILE_CHUNK_BYTES } from '@superone/shared/environment'
import { dispatchRpc } from './rpc-dispatch'
import type { RpcContext } from './rpc-context'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
afterEach(() => vi.unstubAllEnvs())
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'temp-preview-rpc-'))
  dirs.push(dir)
  return dir
}
function context(scopes = ['workspace:read']): RpcContext {
  return {
    client: { clientSessionId: 'controller', scopes },
    workspaceFs: {},
    hooks: {},
  } as unknown as RpcContext
}

describe('remote temporary file reads', () => {
  it('uses the host OS temp directory and caps reads to the RPC frame budget', async () => {
    const dir = directory()
    vi.stubEnv(process.platform === 'win32' ? 'TEMP' : 'TMPDIR', dir)
    const path = join(dir, 'large.bin')
    writeFileSync(path, Buffer.alloc(TEMP_FILE_CHUNK_BYTES + 7, 42))
    const result = await dispatchRpc('fs.readTempFile', { path, offset: 0, maxBytes: TEMP_FILE_CHUNK_BYTES * 2 }, context())
    const chunk = result.result as { chunk: string; eof: boolean }
    expect(Buffer.from(chunk.chunk, 'base64')).toHaveLength(TEMP_FILE_CHUNK_BYTES)
    expect(chunk.eof).toBe(false)
  })

  it('stats and reads binary and text files outside any project, in bounded chunks', async () => {
    const path = join(directory(), 'image #1.png')
    const bytes = Buffer.from([0x89, 0x50, 0, 0xff, 1, 2])
    writeFileSync(path, bytes)
    expect(await dispatchRpc('fs.statTempFile', { path }, context())).toMatchObject({
      result: { exists: true, size: bytes.length },
    })
    const first = await dispatchRpc('fs.readTempFile', { path, offset: 0, maxBytes: 4 }, context())
    expect(first).toMatchObject({ result: { chunk: bytes.subarray(0, 4).toString('base64'), total: 6, eof: false } })
    expect(await dispatchRpc('fs.readTempFile', { path, offset: 4, maxBytes: 4 }, context()))
      .toMatchObject({ result: { chunk: bytes.subarray(4).toString('base64'), total: 6, eof: true } })
    writeFileSync(path, '临时文本')
    expect(await dispatchRpc('fs.readTempFile', { path, offset: 0, maxBytes: 100 }, context()))
      .toMatchObject({ result: { chunk: Buffer.from('临时文本').toString('base64'), eof: true } })
  })

  it('checks read scope before touching a file', async () => {
    expect(await dispatchRpc('fs.statTempFile', { path: '/tmp/nope' }, context([])))
      .toMatchObject({ error: { code: 'forbidden' } })
  })

  it('refuses non-temp paths, traversal and symlinks escaping a temp root', async () => {
    const dir = directory()
    symlinkSync('/etc/hosts', join(dir, 'hosts'))
    for (const path of ['/etc/hosts', '/tmp/../etc/hosts', join(dir, 'hosts')]) {
      for (const method of ['fs.statTempFile', 'fs.readTempFile']) {
        expect(await dispatchRpc(method, { path, offset: 0, maxBytes: 10 }, context()))
          .toMatchObject({ error: { code: 'forbidden' } })
      }
    }
  })

  it('handles missing files and rejects directories and invalid ranges', async () => {
    const dir = directory()
    const path = join(dir, 'empty.txt')
    expect(await dispatchRpc('fs.statTempFile', { path }, context()))
      .toMatchObject({ result: { exists: false } })
    writeFileSync(path, '')
    mkdirSync(join(dir, 'folder'))
    expect(await dispatchRpc('fs.statTempFile', { path: join(dir, 'folder') }, context()))
      .toMatchObject({ error: { code: 'invalid_argument' } })
    for (const input of [{ offset: -1, maxBytes: 1 }, { offset: 0, maxBytes: 0 }, { offset: 0.5, maxBytes: 1 }]) {
      expect(await dispatchRpc('fs.readTempFile', { path, ...input }, context()))
        .toMatchObject({ error: { code: 'invalid_argument' } })
    }
    expect(await dispatchRpc('fs.readTempFile', { path, offset: 0, maxBytes: 1 }, context()))
      .toMatchObject({ result: { chunk: '', total: 0, eof: true } })
  })
})
