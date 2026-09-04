import { describe, expect, it } from 'vitest'
import { sanitizeRemoteToolInput, shouldKeepRemoteToolInput } from './remote-tool-input'

describe('remote tool input exemptions', () => {
  it('keeps only inputs needed by native mobile actions', () => {
    expect(shouldKeepRemoteToolInput('mcp__superone__widget_show')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__mobile_share_file')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__media_generate_image')).toBe(true)
    expect(shouldKeepRemoteToolInput('mcp__superone__media_generate_video')).toBe(true)
    expect(shouldKeepRemoteToolInput('Read')).toBe(false)
    expect(shouldKeepRemoteToolInput('mcp__other__widget_showcase')).toBe(false)
  })

  it('keeps only presenter-routing metadata for Browser tools', () => {
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_act',
      JSON.stringify({
        description: 'Submit checkout',
        actions: [{ type: 'type', selector: '#password', text: 'secret-123' }, { type: 'click', selector: '#submit' }],
      }),
    ))).toEqual({
      description: 'Submit checkout',
      actions: [{ type: 'type' }, { type: 'click' }],
    })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_snapshot',
      JSON.stringify({ include: ['screenshot'], selector: '#private' }),
    ))).toEqual({ include: ['screenshot'] })
    expect(JSON.parse(sanitizeRemoteToolInput(
      'mcp__superone__browser_tools_call',
      JSON.stringify({ name: 'add_to_cart', description: 'Add item', input: { card: '4111' } }),
    ))).toEqual({ description: 'Add item', name: 'add_to_cart' })
  })

  it('continues stripping unrelated tool input', () => {
    expect(sanitizeRemoteToolInput('Read', '{"file_path":"/private"}')).toBe('')
  })
})
