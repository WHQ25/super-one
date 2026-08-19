import { describe, it, expect } from 'vitest'
import {
  wrapCapabilityMention,
  replaceCapabilityTagsWithMention,
  stripCapabilityMarkup,
  getBuiltinCapability,
  isBuiltinCapabilityId,
  capabilityToolPrefixClaude,
  capabilityToolPrefixCodex,
  formatCapabilityReminderLine,
  isStoredCapabilityId,
} from './capability-prompt-tags'

describe('capability-prompt-tags', () => {
  it('resolves known ids', () => {
    expect(isBuiltinCapabilityId('browser')).toBe(true)
    expect(isBuiltinCapabilityId('widget')).toBe(true)
    expect(isBuiltinCapabilityId('debug')).toBe(true)
    expect(isBuiltinCapabilityId('file')).toBe(false)
    // Retired: naming the agent directly (@codex) replaced it.
    expect(isBuiltinCapabilityId('collab')).toBe(false)
    expect(getBuiltinCapability('collab')).toBeUndefined()
    expect(isStoredCapabilityId('collab')).toBe(true)
    expect(getBuiltinCapability('widget')?.displayName).toBe('Widget')
    expect(getBuiltinCapability('widget')?.toolPrefix).toBe('widget_')
    expect(getBuiltinCapability('debug')?.displayName).toBe('Debug')
    expect(getBuiltinCapability('debug')?.toolPrefix).toBeUndefined()
    expect(getBuiltinCapability('debug')?.hint).toMatch(/read_manual/)
  })

  it('wraps a capability mention tag', () => {
    expect(wrapCapabilityMention('browser')).toBe(
      '<superone-capability><name>Super Browser</name><id>browser</id></superone-capability>',
    )
    expect(wrapCapabilityMention('computer', 'Desktop')).toBe(
      '<superone-capability><name>Desktop</name><id>computer</id></superone-capability>',
    )
  })

  it('replaces tags with @name and strips reminder', () => {
    const input =
      '<superone-capability><name>Super Browser</name><id>browser</id></superone-capability> open it\n\n' +
      '<superone-capability-reminder>\ntools\n</superone-capability-reminder>'
    const out = replaceCapabilityTagsWithMention(input)
    expect(out).toBe('@Super Browser open it')
    expect(out).not.toContain('superone-capability')
  })

  it('strip collapses whitespace for titles', () => {
    const input =
      '<superone-capability><name>Agents Collaboration</name><id>collab</id></superone-capability>\n\nhelp'
    expect(stripCapabilityMarkup(input)).toBe('@Agents Collaboration help')
  })

  it('builds tool prefixes for each harness style', () => {
    const browser = getBuiltinCapability('browser')!
    expect(capabilityToolPrefixClaude(browser)).toBe('mcp__superone__browser_')
    expect(capabilityToolPrefixCodex(browser)).toBe('mcp__superone.browser_')
    const widget = getBuiltinCapability('widget')!
    expect(capabilityToolPrefixClaude(widget)).toBe('mcp__superone__widget_')
    expect(capabilityToolPrefixCodex(widget)).toBe('mcp__superone.widget_')
    expect(capabilityToolPrefixClaude(getBuiltinCapability('debug')!)).toBeUndefined()
  })

  it('uses hint instead of a tool prefix for debug', () => {
    const debug = getBuiltinCapability('debug')!
    const line = formatCapabilityReminderLine(debug, 'claude')
    expect(line).toContain('"Debug"')
    expect(line).toContain('read_manual({ domain: "product", topic: "debug" })')
    expect(line).toContain('no GitHub account')
    expect(line).not.toContain('tools start with')
  })
})
