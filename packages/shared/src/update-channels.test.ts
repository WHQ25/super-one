import { describe, it, expect } from 'vitest'
import { channelFromVersion, UPDATE_CHANNEL_TO_YML, UPDATE_CHANNELS } from './update-channels'

describe('channelFromVersion', () => {
  it('maps prerelease tags to their channel and bare versions to stable', () => {
    expect(channelFromVersion('0.40.1-alpha')).toBe('alpha')
    expect(channelFromVersion('1.0.0-beta.2')).toBe('beta')
    expect(channelFromVersion('1.0.0')).toBe('stable')
    expect(channelFromVersion('2.3.4')).toBe('stable')
  })
})

describe('update channel maps', () => {
  it('exposes the three user channels and their electron-builder yml tracks', () => {
    expect(UPDATE_CHANNELS).toEqual(['stable', 'beta', 'alpha'])
    expect(UPDATE_CHANNEL_TO_YML).toEqual({ stable: 'latest', beta: 'beta', alpha: 'alpha' })
  })
})
