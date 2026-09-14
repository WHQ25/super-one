/**
 * The files-previewer context for a remote session, and the Retry path that
 * has only the payload's `remote:` root to work from
 * (inline-files-previewer.md §2.2).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@superone/shared/environment'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

import { resolveRemotePreviewerContext, statPreviewerFileForRoot, type PreviewerHost } from './files-previewer-context'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'previewer-ctx-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fakeHost(opts: { project: Record<string, WorkspaceEntry[]>; zone?: Record<string, Buffer>; session?: { cwd?: string; projectId?: string } | null }): PreviewerHost {
  const zone = opts.zone ?? {}
  return {
    getSession: async () => opts.session === undefined ? { cwd: '/home/node/proj', projectId: 'p1' } : opts.session,
    getRemoteProjectPath: async () => '/home/node/proj',
    getSyncZone: () => ({ syncRoot: '/home/node/.superone/node/sync', os: 'linux' }),
    artifactStat: async (_c, _s, rel) => {
      const f = zone[rel]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_000_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    artifactGet: async (_c, input) => {
      const f = zone[input.relativePath]!
      const slice = f.subarray(input.offset, input.offset + input.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_000_000, eof: input.offset + slice.length >= f.length }
    },
    remoteWorkspaceListDir: async (_c, _p, dir) => opts.project[dir] ?? [],
  }
}

describe('remote previewer context', () => {
  it('keys the payload by the project host path and resolves files where they live', async () => {
    const host = fakeHost({ project: { docs: [{ name: 'plan.md', path: 'docs/plan.md', type: 'file', size: 12 }] } })
    const ctx = await resolveRemotePreviewerContext('c1', 's1', host)
    expect(ctx?.root).toBe('remote:c1:/home/node/proj')
    expect(await ctx!.resolveOne({ path: 'docs/plan.md' })).toMatchObject({ kind: 'markdown', size: 12 })
  })

  it('answers nothing for a session the node does not know', async () => {
    expect(await resolveRemotePreviewerContext('c1', 's1', fakeHost({ project: {}, session: null }))).toBeUndefined()
  })
})

describe('re-stat for Retry', () => {
  it('stats a node project file that appeared after the card said missing', async () => {
    // The first build saw no file; the agent wrote it; Retry must find it on the node, not on this disk.
    const host = fakeHost({ project: { reports: [{ name: 'q3.pdf', path: 'reports/q3.pdf', type: 'file', size: 512 }] } })
    const file = await statPreviewerFileForRoot('remote:c1:/home/node/proj', '/home/node/proj/reports/q3.pdf', { host, projectIdFor: async () => 'p1' })
    expect(file).toMatchObject({ kind: 'pdf', size: 512, absolutePath: '/home/node/proj/reports/q3.pdf' })
  })

  it('stats a zone file through the mirror', async () => {
    const host = fakeHost({ project: {}, zone: { 'agent/report.md': Buffer.from('# done') } })
    const file = await statPreviewerFileForRoot('remote:c1:/home/node/proj', '/home/node/.superone/node/sync/s1/agent/report.md', { host, projectIdFor: async () => 'p1' })
    expect(file).toMatchObject({ kind: 'markdown', size: 6 })
  })

  it('leaves a local root to the local resolver', async () => {
    expect(await statPreviewerFileForRoot('/Users/me/proj', '/Users/me/proj/a.md')).toBeUndefined()
  })
})
