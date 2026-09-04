import { describe, expect, it } from 'vitest'
import { shouldKeepRemoteToolInput } from './remote-tool-input'

describe('remote tool input exemptions', () => {
  it('keeps only inputs needed by native mobile actions', () => {
    expect(shouldKeepRemoteToolInput('mcp__superone__widget_show')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__mobile_share_file')).toBe(true)
    expect(shouldKeepRemoteToolInput('Read')).toBe(false)
    expect(shouldKeepRemoteToolInput('mcp__other__widget_showcase')).toBe(false)
  })
})
