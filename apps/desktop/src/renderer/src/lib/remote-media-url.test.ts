/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import {
  decodeRemoteMediaUrl,
  encodeRemoteMediaUrl,
  isRemoteMediaUrl,
  relativeUnderRemoteProject,
  resolveDisplayMediaSrc,
  resolveMediaSrcForProject,
} from './remote-media-url'

describe('remote-media-url', () => {
  const project = 'remote:conn-1:/Users/me/app'

  it('round-trips encode/decode', () => {
    const url = encodeRemoteMediaUrl(project, 'assets/shot.png')
    expect(isRemoteMediaUrl(url)).toBe(true)
    expect(decodeRemoteMediaUrl(url)).toEqual({
      projectPath: project,
      relativePath: 'assets/shot.png',
    })
  })

  it('resolveMediaSrcForProject uses remote-media for relative paths', () => {
    const src = resolveMediaSrcForProject('./assets/a.png', project)
    expect(isRemoteMediaUrl(src)).toBe(true)
    expect(decodeRemoteMediaUrl(src)?.relativePath).toBe('assets/a.png')
  })

  it('resolveMediaSrcForProject maps host-absolute under project to relative', () => {
    const src = resolveMediaSrcForProject('/Users/me/app/img.png', project)
    expect(decodeRemoteMediaUrl(src)?.relativePath).toBe('img.png')
  })

  it('relativeUnderRemoteProject rejects foreign paths', () => {
    expect(relativeUnderRemoteProject(project, '/other/x.png')).toBeNull()
  })

  it('keeps the connection for an out-of-project node path (a sync-zone artifact)', () => {
    // A node screenshot lives under the node home, not the project — the URL must
    // still carry the connection so the main process can resolve it.
    const nodePath = '/home/node/.superone/node/sync/s1/browser/shot.png'
    const src = resolveMediaSrcForProject(nodePath, project)
    expect(isRemoteMediaUrl(src)).toBe(true)
    expect(decodeRemoteMediaUrl(src)).toEqual({ projectPath: project, relativePath: nodePath })
  })

  it('displays a zone media file from the local-file URL the host returns, not only from a data URI', async () => {
    // Large media does not fit a data URI; the host answers with the URL of
    // its mirror instead, which the local-file protocol streams by range.
    const url = 'local-file:///Users/me/Library/Application%20Support/SuperOne/sync/s1/recording/run.mp4'
    Object.assign(window.app, { readProjectFile: vi.fn(async () => ({ path: '/x', content: url, language: 'video' })) })
    expect(await resolveDisplayMediaSrc(encodeRemoteMediaUrl(project, '/home/node/sync/s1/recording/run.mp4'))).toBe(url)
  })

  it('local project still uses local-file URLs', () => {
    const src = resolveMediaSrcForProject('./a.png', '/Users/me/local')
    expect(src).toBe('local-file:///Users/me/local/a.png')
  })
})
