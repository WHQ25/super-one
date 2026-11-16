import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEMP_FILE_CHUNK_BYTES } from '@superone/shared/environment'
import { landOnRemote, withRemoteBranchBundle } from './remote-worktree'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

const FOLDER = 'remote:lab:/work/app'
const HEAD = 'a'.repeat(40)
const trash: string[] = []
afterEach(() => { while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true }) })

function setup(methods: string[], gateway: Record<string, unknown> = {}) {
  const gw = {
    getDescriptor: async () => ({ capabilities: { methods } }),
    gitUploadBundle: vi.fn(async (input: { offset: number; chunk: string }) => ({ size: input.offset + Buffer.from(input.chunk, 'base64').length })),
    gitApplyIncomingBranch: vi.fn(async () => ({ ok: true, branch: 'feat/x', head: HEAD, status: 'created', snapshot: false })),
    ...gateway,
  } as unknown as RemoteEnvironmentGateway
  Object.setPrototypeOf(gw, RemoteEnvironmentGateway.prototype)
  const host = {
    connections: { listKnown: () => [{ connectionId: 'lab', environmentId: 'env-lab' }] },
    listProjects: vi.fn().mockResolvedValue([{ projectId: 'p1', path: '/work/app' }]),
    getGateway: () => gw,
    resolveRemoteTempFile: vi.fn(),
  } as unknown as EnvironmentHost
  return { host, gw: gw as unknown as Record<string, ReturnType<typeof vi.fn>> }
}

function bundleOf(size: number): string {
  const dir = mkdtempSync(join(tmpdir(), 's1-land-'))
  trash.push(dir)
  const path = join(dir, 'branch.bundle')
  writeFileSync(path, Buffer.alloc(size, 1))
  return path
}

describe('landOnRemote', () => {
  it('uploads the bundle in order with progress, then lands it on the node', async () => {
    const { host, gw } = setup(['git.applyIncomingBranch'])
    const size = TEMP_FILE_CHUNK_BYTES + 5
    const progress: unknown[] = []
    const result = await landOnRemote(host, FOLDER, { bundlePath: bundleOf(size), localName: 'feat/x', head: HEAD, snapshot: null },
      { onProgress: (...args) => progress.push(args) })
    expect(result).toMatchObject({ ok: true })
    expect(gw.gitUploadBundle!.mock.calls.map(([input]) => input.offset)).toEqual([0, TEMP_FILE_CHUNK_BYTES])
    const uploadId = gw.gitUploadBundle!.mock.calls[0]![0].uploadId
    expect(gw.gitApplyIncomingBranch).toHaveBeenCalledWith({
      projectId: 'p1', upload: { uploadId, size }, localName: 'feat/x', head: HEAD, snapshot: null,
    })
    expect(progress).toEqual([['uploading', 0, size], ['uploading', TEMP_FILE_CHUNK_BYTES, size], ['uploading', size, size], ['applying']])
  })

  it('lands without an upload when the node already has the commits', async () => {
    const { host, gw } = setup(['git.applyIncomingBranch'])
    await landOnRemote(host, FOLDER, { bundlePath: null, localName: 'feat/x', head: HEAD, snapshot: null })
    expect(gw.gitUploadBundle).not.toHaveBeenCalled()
    expect(gw.gitApplyIncomingBranch).toHaveBeenCalledWith(expect.objectContaining({ upload: null }))
  })

  it('stops between chunks when cancelled and never lands', async () => {
    const { host, gw } = setup(['git.applyIncomingBranch'])
    const abort = new AbortController()
    await expect(landOnRemote(host, FOLDER, { bundlePath: bundleOf(TEMP_FILE_CHUNK_BYTES * 2), localName: 'feat/x', head: HEAD, snapshot: null }, {
      signal: abort.signal,
      onProgress: (phase, done) => { if (phase === 'uploading' && done) abort.abort() },
    })).rejects.toMatchObject({ code: 'cancelled' })
    expect(gw.gitUploadBundle).toHaveBeenCalledTimes(1)
    expect(gw.gitApplyIncomingBranch).not.toHaveBeenCalled()
  })

  it('names a node that cannot receive branches', async () => {
    const { host } = setup(['git.status'])
    await expect(landOnRemote(host, FOLDER, { bundlePath: null, localName: 'x', head: HEAD, snapshot: null }))
      .rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('withRemoteBranchBundle', () => {
  it('reports bundling then download bytes, and removes the local copy', async () => {
    const copy = bundleOf(10)
    const { host } = setup(['git.exportBundle'], {
      gitExportBundle: vi.fn(async () => ({ ok: true, branch: 'feat/x', head: HEAD, snapshot: null, bundlePath: '/tmp/n/branch.bundle', size: 10 })),
    })
    vi.mocked(host.resolveRemoteTempFile).mockImplementation(async (_conn, _path, options) => {
      options?.onProgress?.(10, 10)
      return { kind: 'local', path: copy, size: 10 }
    })
    const progress: unknown[] = []
    const use = vi.fn(async () => ({ ok: true as const, branch: 'feat/x', head: HEAD, status: 'created' as const, snapshot: false }))
    await withRemoteBranchBundle(host, { folderPath: FOLDER, branch: 'feat/x', haves: [], includeWorkingTree: false }, use,
      { onProgress: (...args) => progress.push(args) })
    expect(progress).toEqual([['bundling'], ['downloading', 0, 10], ['downloading', 10, 10]])
    expect(use).toHaveBeenCalledWith(expect.objectContaining({ bundlePath: copy }))
    expect(() => writeFileSync(copy, '', { flag: 'r+' })).toThrow()
  })
})
