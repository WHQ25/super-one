import { describe, expect, it } from 'vitest'
import { directoryEntryAction, joinRemotePath, parentRemotePath, resolveRemoteFilePath } from './shell-state'

describe('remote path navigation', () => {
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
