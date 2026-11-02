import { describe, expect, it } from 'vitest'
import { planNewSessionFromFocus, shouldStampEnvironment } from './new-session-from-focus'

const local = {
  environmentId: 'desktop',
  connectionId: 'local',
  checkouts: [{ pathKey: '/repo', projectId: 'local-repo' }],
}
const office = {
  environmentId: 'office',
  connectionId: 'cli-1',
  checkouts: [{ pathKey: 'remote:cli-1:/srv/app', projectId: 'remote-app' }],
}

describe('new session from sidebar focus', () => {
  it('keeps the open project when nothing is focused', () => {
    expect(planNewSessionFromFocus({
      focus: null,
      environments: [local, office],
      currentFolder: '/repo',
    })).toEqual({})
  })

  it('opens the focused project on its environment', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'project', folderPath: 'remote:cli-1:/srv/app', environmentId: 'office' },
      environments: [local, office],
      currentFolder: '/repo',
    })).toEqual({
      select: {
        folderPath: 'remote:cli-1:/srv/app',
        connectionId: 'cli-1',
        projectId: 'remote-app',
      },
      environmentId: 'office',
    })
  })

  it('uses the focused session project and environment', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'session', folderPath: '/repo', sessionId: 's1', environmentId: 'desktop' },
      environments: [local],
      currentFolder: '/other',
    })).toEqual({
      select: { folderPath: '/repo', connectionId: 'local', projectId: 'local-repo' },
      environmentId: 'desktop',
    })
  })

  it('does not reselect a project that is already open', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'project', folderPath: '/repo', environmentId: 'desktop' },
      environments: [local],
      currentFolder: '/repo',
    })).toEqual({ environmentId: 'desktop' })
  })

  it('keeps the open project when it already runs on the focused environment', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'environment', environmentId: 'office' },
      environments: [local, office],
      currentFolder: 'remote:cli-1:/srv/app',
    })).toEqual({ environmentId: 'office' })
  })

  it('switches host when only an environment is focused and the open project is elsewhere', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'environment', environmentId: 'office' },
      environments: [local, office],
      currentFolder: '/repo',
    })).toEqual({ hostConnectionId: 'cli-1', environmentId: 'office' })
  })

  it('leaves the open project alone when the focused environment is not loaded', () => {
    expect(planNewSessionFromFocus({
      focus: { kind: 'environment', environmentId: 'missing' },
      environments: [local],
      currentFolder: '/repo',
    })).toEqual({})
  })

  it('stamps the execution environment only when the fresh session is not already there', () => {
    expect(shouldStampEnvironment(null, 'office', true)).toBe(true)
    expect(shouldStampEnvironment(
      { environmentId: 'cli-1', selection: { kind: 'local' } },
      'office',
      true,
    )).toBe(true)
    expect(shouldStampEnvironment(
      { environmentId: 'office', selection: { kind: 'local' } },
      'office',
      true,
    )).toBe(false)
    expect(shouldStampEnvironment(
      { environmentId: 'office', selection: { kind: 'existing' } },
      'office',
      true,
    )).toBe(true)
    expect(shouldStampEnvironment(null, 'office', false)).toBe(false)
  })
})
