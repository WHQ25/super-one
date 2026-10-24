import { describe, expect, it } from 'vitest'
import { createDefaultProjectState } from '../defaults'
import { noteListedUnread } from './unseen-completed'

describe('noteListedUnread', () => {
  it('adds listed unread rows and leaves the open session alone', () => {
    const open = createDefaultProjectState()
    open._activeSessionId = 'open'
    const seeded = noteListedUnread({
      projectSessions: { '/app': open },
    }, [
      { folderPath: '/app', sessionId: 'open' },
      { folderPath: '/app', sessionId: 'cold' },
    ])
    expect([...(seeded.projectSessions?.['/app']?.unseenCompletedSessions ?? [])]).toEqual(['cold'])
  })

  it('does not drop an unread the list has not caught up with', () => {
    const project = createDefaultProjectState()
    project.unseenCompletedSessions.add('marked')
    const next = noteListedUnread(
      { projectSessions: { '/app': project } },
      [{ folderPath: '/app', sessionId: 'other' }],
    )
    expect([...(next.projectSessions?.['/app']?.unseenCompletedSessions ?? [])].sort()).toEqual(['marked', 'other'])
  })
})
