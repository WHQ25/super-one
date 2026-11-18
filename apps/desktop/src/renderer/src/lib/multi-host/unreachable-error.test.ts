import { describe, expect, it } from 'vitest'
import { environmentUnreachable, isRemoteUnreachableError } from './unreachable-error'

describe('isRemoteUnreachableError', () => {
  it('matches a dead node socket, including the Electron IPC wrapper', () => {
    expect(isRemoteUnreachableError("Error invoking remote method 'environment:listProjects': Error: not connected")).toBe(true)
    expect(isRemoteUnreachableError('environment is not connected')).toBe(true)
    expect(isRemoteUnreachableError('Error: not connected')).toBe(true)
    expect(isRemoteUnreachableError('not connected')).toBe(true)
  })

  it('leaves a real catalog failure visible', () => {
    expect(isRemoteUnreachableError('socket closed while listing /srv/projects')).toBe(false)
    expect(isRemoteUnreachableError('node refused')).toBe(false)
    expect(isRemoteUnreachableError('timed out')).toBe(false)
    expect(isRemoteUnreachableError('Studio Mac is not connected')).toBe(false)
    expect(isRemoteUnreachableError(null)).toBe(false)
  })
})

describe('environmentUnreachable', () => {
  it('is a live row whose project list failed because the socket is down', () => {
    expect(environmentUnreachable({
      connection: 'connected',
      projectsStatus: 'error',
      projectsError: "Error invoking remote method 'environment:listProjects': Error: not connected",
    })).toBe(true)
    expect(environmentUnreachable({
      connection: 'offline',
      projectsStatus: 'error',
      projectsError: 'not connected',
    })).toBe(false)
    expect(environmentUnreachable({
      connection: 'connected',
      projectsStatus: 'error',
      projectsError: 'node refused',
    })).toBe(false)
  })
})
