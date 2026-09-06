import { describe, expect, it } from 'vitest'
import { directoryEntryAction, isWithinRemoteRoot, joinRemotePath, parentRemotePath, remoteBreadcrumbs, remoteBreadcrumbsWithin, resolveRemoteFilePath } from './shell-state'

describe('remote path navigation', () => {
  it('builds navigable breadcrumbs without escaping drive or share roots', () => {
    expect(remoteBreadcrumbs('/repo/src').map((item) => item.path)).toEqual(['/', '/repo', '/repo/src'])
    expect(remoteBreadcrumbs('C:\\repo\\src').map((item) => item.path)).toEqual(['C:/', 'C:/repo', 'C:/repo/src'])
    expect(remoteBreadcrumbs('\\\\host\\share\\src')).toEqual([
      { path: '//host/share', label: '//host/share' },
      { path: '//host/share/src', label: 'src' },
    ])
  })
  it('joins and moves to a parent without escaping root', () => {
    expect(joinRemotePath('/repo/', 'src')).toBe('/repo/src')
    expect(parentRemotePath('/repo/src')).toBe('/repo')
    expect(parentRemotePath('/repo')).toBe('/')
    expect(parentRemotePath('/')).toBe('/')
  })

  it('resolves metadata paths relative to the active project', () => {
    expect(resolveRemoteFilePath('/repo', 'src/App.tsx')).toBe('/repo/src/App.tsx')
    expect(resolveRemoteFilePath('/repo', '/tmp/output.txt')).toBe('/tmp/output.txt')
    expect(resolveRemoteFilePath('C:\\repo', 'src\\App.tsx')).toBe('C:/repo/src/App.tsx')
    expect(resolveRemoteFilePath('C:\\repo', 'D:\\output.txt')).toBe('D:\\output.txt')
    expect(resolveRemoteFilePath('C:\\repo', '\\\\server\\share\\output.txt'))
      .toBe('\\\\server\\share\\output.txt')
  })

  it('navigates Windows drive and UNC roots without falling through to POSIX root', () => {
    expect(joinRemotePath('C:\\repo\\', 'src')).toBe('C:/repo/src')
    expect(parentRemotePath('C:\\repo\\src')).toBe('C:/repo')
    expect(parentRemotePath('C:\\repo')).toBe('C:/')
    expect(parentRemotePath('C:\\')).toBe('C:/')
    expect(parentRemotePath('\\\\server\\share\\folder')).toBe('//server/share')
    expect(parentRemotePath('\\\\server\\share')).toBe('//server/share')
  })

  it('routes directories to navigation and files to the secure preview path', () => {
    expect(directoryEntryAction('/repo', { name: 'src', isDirectory: true }))
      .toEqual({ kind: 'directory', path: '/repo/src' })
    expect(directoryEntryAction('/repo', { name: 'report.pdf', isDirectory: false }))
      .toEqual({ kind: 'file', path: '/repo/report.pdf' })
  })
})

describe('a file browser anchored to the project root', () => {
  it('names only the folders below the root, because the header owns the root itself', () => {
    expect(remoteBreadcrumbsWithin('/repo', '/repo/apps/mobile')).toEqual([
      { path: '/repo/apps', label: 'apps' },
      { path: '/repo/apps/mobile', label: 'mobile' },
    ])
  })

  it('shows no crumbs while sitting on the root', () => {
    expect(remoteBreadcrumbsWithin('/repo', '/repo')).toEqual([])
    expect(remoteBreadcrumbsWithin('/repo/', '/repo')).toEqual([])
  })

  // A file the agent touched outside the project has no reading relative to the
  // root, so the bar falls back to naming the whole path rather than going blank.
  it('falls back to the absolute chain for a path outside the root', () => {
    expect(remoteBreadcrumbsWithin('/repo', '/tmp/scratch').map((item) => item.path))
      .toEqual(['/', '/tmp', '/tmp/scratch'])
  })

  it('treats separators and trailing slashes as the same path', () => {
    expect(isWithinRemoteRoot('/repo', '/repo/src')).toBe(true)
    expect(isWithinRemoteRoot('/repo/', '/repo')).toBe(true)
    expect(isWithinRemoteRoot('C:\\repo', 'C:/repo/src')).toBe(true)
    expect(remoteBreadcrumbsWithin('C:\\repo', 'C:\\repo\\src')).toEqual([
      { path: 'C:/repo/src', label: 'src' },
    ])
  })

  // `/repos/other` starts with `/repo` as a string but is a sibling, not a child.
  it('does not mistake a sibling with a shared prefix for a child', () => {
    expect(isWithinRemoteRoot('/repo', '/repository')).toBe(false)
    expect(isWithinRemoteRoot('/repo', '/repo-backup/src')).toBe(false)
  })
})
