import { describe, expect, it } from 'vitest'
import { hostPathsEqual, normalizeHostPath, remoteActiveFileRoot } from './remote-resource-key'

describe('normalizeHostPath', () => {
  it('collapses dot segments, slash direction, and a trailing slash', () => {
    expect(normalizeHostPath('/work/app/')).toBe('/work/app')
    expect(normalizeHostPath('/work/app/.')).toBe('/work/app')
    expect(normalizeHostPath('/work/app/../app')).toBe('/work/app')
    expect(normalizeHostPath('C:\\work\\app\\.')).toBe('C:/work/app')
    expect(hostPathsEqual('/work/app', '/work/app/.')).toBe(true)
    expect(hostPathsEqual('/work/app', '/work/app/../app')).toBe(true)
    expect(hostPathsEqual('/work/app', '/work/link/app')).toBe(false)
  })
})

describe('remoteActiveFileRoot', () => {
  const project = 'remote:env-1:/work/app'

  it('keeps a lexical alias of the project root on the project key', () => {
    expect(remoteActiveFileRoot(project, '/work/app/.')).toBe(project)
    expect(remoteActiveFileRoot(project, '/work/app/../app')).toBe(project)
    expect(remoteActiveFileRoot(project, '/work/./app/wt')).toBe('remote:env-1:/work/app/wt')
  })
})
