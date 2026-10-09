import { describe, expect, it } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState } from '../defaults'
import type { ChatStore, PerSessionState } from '../types'
import { applyRemoteControlChange, isControlledElsewhere } from './remote-control'

function storeWith(session: Partial<PerSessionState>): ChatStore {
  return {
    projectSessions: {
      '/p': { ...createDefaultProjectState(), _sessions: { s1: { ...createDefaultPerSessionState(), ...session } } },
    },
  } as unknown as ChatStore
}

const sessionOf = (patch: Partial<ChatStore>) => patch.projectSessions!['/p']._sessions.s1

describe('remote control of a session', () => {
  it('opens the composer on the computer that took a session back, and closes it when the controller reconnects', () => {
    const started = storeWith({ remoteController: { label: 'MacBook Air' } })
    expect(isControlledElsewhere(started.projectSessions['/p']._sessions.s1)).toBe(true)

    const released = sessionOf(applyRemoteControlChange(started, '/p', 's1', true))
    expect(released.remoteController).toEqual({ label: 'MacBook Air', released: true })
    expect(isControlledElsewhere(released)).toBe(false)

    const reclaimed = sessionOf(applyRemoteControlChange(storeWith(released), '/p', 's1', false))
    expect(isControlledElsewhere(reclaimed)).toBe(true)
  })

  it('closes the composer on the controller when the session is taken back, until it reconnects', () => {
    const released = sessionOf(applyRemoteControlChange(storeWith({}), '/p', 's1', true))
    expect(released.remoteControlReleased).toBe(true)
    expect(released.remoteController).toBeUndefined()
    expect(isControlledElsewhere(released)).toBe(true)
    expect(isControlledElsewhere(sessionOf(applyRemoteControlChange(storeWith(released), '/p', 's1', false)))).toBe(false)
  })

  it('ignores a session this window does not hold', () => {
    expect(applyRemoteControlChange(storeWith({}), '/p', 'other', true)).toEqual({})
  })
})
