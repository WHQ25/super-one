import { describe, expect, it } from 'vitest'
import {
  decodeRemoteMediaUrl,
  encodeRemoteMediaUrl,
  isRemoteMediaUrl,
  relativeUnderRemoteProject,
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

  it('local project still uses local-file URLs', () => {
    const src = resolveMediaSrcForProject('./a.png', '/Users/me/local')
    expect(src).toBe('local-file:///Users/me/local/a.png')
  })
})
