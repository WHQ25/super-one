import { describe, expect, it } from 'vitest'
import { parseSessionSettings } from './session-settings'

describe('session settings payload', () => {
  it('retains native harness selections and explicit resets', () => {
    expect(parseSessionSettings({ model: 'm', mode: 'build', agentPreset: null, additionalDirectories: ['/extra'], unrelated: true })).toEqual({ model: 'm', mode: 'build', agentPreset: null, additionalDirectories: ['/extra'] })
    expect(parseSessionSettings({ additionalDirectories: null })).toEqual({ additionalDirectories: null })
  })
  it.each([{ mode: 3 }, { additionalDirectories: [''] }, { additionalDirectories: [true] }, { additionalDirectories: Array(65).fill('/x') }])('rejects invalid selections before a host writes them: %j', (input) => {
    expect(() => parseSessionSettings(input)).toThrow()
  })
})
