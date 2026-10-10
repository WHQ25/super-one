import { describe, expect, it } from 'vitest'
import { LOCAL_ENVIRONMENT_CAPABILITIES, servesMethod } from './capabilities'

describe('servesMethod', () => {
  it('reads the methods an environment reports, and nothing while they are unknown', () => {
    expect(servesMethod({ methods: ['draft.list'] }, 'draft.list')).toBe(true)
    expect(servesMethod({ methods: ['draft.list'] }, 'terminal.create')).toBe(false)
    expect(servesMethod(undefined, 'draft.list')).toBe(false)
    expect(servesMethod({}, 'draft.list')).toBe(false)
  })
})

describe('local mobile voice capability', () => {
  it('retains the desktop-hosted phone voice capability', () => {
    expect(LOCAL_ENVIRONMENT_CAPABILITIES.mobileRealtimeVoice).toBe(true)
  })
})
