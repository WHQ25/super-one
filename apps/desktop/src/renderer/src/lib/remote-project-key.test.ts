import { describe, expect, it } from 'vitest'
import {
  displayHostPath,
  parseRemoteProjectKey,
  projectBelongsToHost,
  remoteProjectKey,
} from './remote-project-key'

describe('remote project keys', () => {
  it('round-trips connection id and host path', () => {
    const key = remoteProjectKey('env-1', '/work/app')
    expect(key).toBe('remote:env-1:/work/app')
    expect(parseRemoteProjectKey(key)).toEqual({ connectionId: 'env-1', path: '/work/app' })
    expect(displayHostPath(key)).toBe('/work/app')
    expect(displayHostPath('/local/only')).toBe('/local/only')
  })

  it('classifies project ownership by host', () => {
    expect(projectBelongsToHost(null, 'local')).toBe(true)
    expect(projectBelongsToHost('/Users/dev/app', 'local')).toBe(true)
    expect(projectBelongsToHost('/Users/dev/app', 'env-1')).toBe(false)
    expect(projectBelongsToHost('remote:env-1:/work/app', 'env-1')).toBe(true)
    expect(projectBelongsToHost('remote:env-1:/work/app', 'env-2')).toBe(false)
    expect(projectBelongsToHost('remote:env-1:/work/app', 'local')).toBe(false)
  })
})
