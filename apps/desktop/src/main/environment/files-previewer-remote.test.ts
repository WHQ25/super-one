/**
 * The files-previewer resolver for a remote-node session: a screenshot the
 * desktop pushed to the node reads from the mirror, a node project file from
 * workspace.listDir, and an out-of-project absolute path is unpreviewable —
 * never spliced into the project (inline-files-previewer.md §2.2).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@superone/shared/environment'
import { OFFICE_PREVIEW_MAX_BYTES } from '@superone/shared/file-preview'

const state = vi.hoisted(() => ({ userData: '' }))
// The zone's delivery record: a table that cannot be read protects every zone file (R5).
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { resolveRemotePreviewerFile, type RemotePreviewerContext } from './files-previewer-remote'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'previewer-remote-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const zone = { syncRoot: '/home/node/.superone/node/sync', os: 'linux' as const }

function ctx(overrides: Partial<RemotePreviewerContext> & { files?: Record<string, Buffer>; project?: WorkspaceEntry[] } = {}): RemotePreviewerContext {
  const files = overrides.files ?? {}
  return {
    connectionId: 'c1',
    hostPath: '/home/node/proj',
    cwd: '/home/node/proj',
    zone,
    artifactStat: async (_s, rel) => {
      const f = files[rel]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    artifactGet: async (input) => {
      const f = files[input.relativePath]!
      const slice = f.subarray(input.offset, input.offset + input.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: input.offset + slice.length >= f.length }
    },
    listDir: async () => overrides.project ?? [],
    ...overrides,
  }
}

describe('remote files previewer resolver', () => {
  it('resolves a node zone screenshot via the mirror and keeps its node path as absolutePath', async () => {
    const file = await resolveRemotePreviewerFile(
      { path: '/home/node/.superone/node/sync/s1/browser/shot.png', note: 'the result' },
      ctx({ files: { 'browser/shot.png': Buffer.from('pngdata') } }),
    )
    expect(file).toMatchObject({ kind: 'image', size: 7, note: 'the result', absolutePath: '/home/node/.superone/node/sync/s1/browser/shot.png' })
  })

  it('accepts the desktop mirror path the host action input mapping produced and reports the node twin', async () => {
    // §3.1 rewrites every node-zone string in the tool args to the desktop
    // mirror before the tool runs, so the builder sees a desktop path; the
    // card must still classify it and hand the renderer the node identity.
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const mirror = join(root, 'sync', 's1', 'browser')
    mkdirSync(mirror, { recursive: true })
    writeFileSync(join(mirror, 'shot.png'), Buffer.from('pngdata'))
    const file = await resolveRemotePreviewerFile(
      { path: join(mirror, 'shot.png') },
      ctx({ files: { 'browser/shot.png': Buffer.from('pngdata') } }),
    )
    expect(file).toMatchObject({ kind: 'image', size: 7, path: '/home/node/.superone/node/sync/s1/browser/shot.png', absolutePath: '/home/node/.superone/node/sync/s1/browser/shot.png' })
  })

  it('reports a zone file that neither the mirror nor the node has as missing', async () => {
    const file = await resolveRemotePreviewerFile({ path: '/home/node/.superone/node/sync/s1/agent/none.md' }, ctx({ files: {} }))
    expect(file.kind).toBe('missing')
  })

  it('previews a small zone docx and does not download one past the cap', async () => {
    const small = await resolveRemotePreviewerFile(
      { path: '/home/node/.superone/node/sync/s1/agent/notes.docx' },
      ctx({ files: { 'agent/notes.docx': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]) } }),
    )
    expect(small).toMatchObject({ kind: 'office', size: 5 })

    const artifactGet = vi.fn()
    const huge = await resolveRemotePreviewerFile(
      { path: '/home/node/.superone/node/sync/s1/agent/deck.pptx' },
      ctx({
        artifactStat: async () => ({ exists: true, size: OFFICE_PREVIEW_MAX_BYTES + 1, mtimeMs: 1 }),
        artifactGet,
      }),
    )
    expect(huge).toMatchObject({ kind: 'unpreviewable', reason: 'too_large', size: OFFICE_PREVIEW_MAX_BYTES + 1 })
    expect(artifactGet).not.toHaveBeenCalled()
  })

  it('marks a project workbook over the transfer cap unpreviewable before reading it', async () => {
    const file = await resolveRemotePreviewerFile(
      { path: 'docs/model.xlsx' },
      ctx({ project: [{ name: 'model.xlsx', path: 'docs/model.xlsx', type: 'file', size: 11 * 1024 * 1024 }] }),
    )
    expect(file).toMatchObject({ kind: 'unpreviewable', reason: 'too_large' })
  })

  it('stats a node project file through workspace.listDir', async () => {
    const file = await resolveRemotePreviewerFile(
      { path: 'docs/plan.md' },
      ctx({ project: [{ name: 'plan.md', path: 'docs/plan.md', type: 'file', size: 42 }] }),
    )
    expect(file).toMatchObject({ kind: 'markdown', size: 42, absolutePath: '/home/node/proj/docs/plan.md' })
  })

  it('resolves a relative path against the live cwd, not the project root', async () => {
    const listed: string[] = []
    const c = ctx({ cwd: '/home/other/scratch', hostPath: '/home/node/proj' })
    // cwd is outside the project host path, so a relative entry lands outside it.
    const file = await resolveRemotePreviewerFile({ path: 'out.png' }, { ...c, listDir: async (dir) => { listed.push(dir); return [] } })
    expect(file.absolutePath).toBe('/home/other/scratch/out.png')
    expect(file.kind).toBe('unpreviewable')
    expect(listed).toEqual([])
  })

  it('marks an absolute path in neither the zone nor the project unpreviewable, never a project guess', async () => {
    const file = await resolveRemotePreviewerFile({ path: '/etc/hosts' }, ctx())
    expect(file).toMatchObject({ kind: 'unpreviewable', reason: 'outside_readable_roots' })
  })

  it('treats a would-be zone path as a project guess when the node has no sync zone', async () => {
    const file = await resolveRemotePreviewerFile(
      { path: '/home/node/proj/report.md' },
      ctx({ zone: null, project: [{ name: 'report.md', path: 'report.md', type: 'file', size: 5 }] }),
    )
    expect(file.kind).toBe('markdown')
  })
})
