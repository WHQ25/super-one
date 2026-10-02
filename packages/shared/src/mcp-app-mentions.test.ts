import { describe, expect, it } from 'vitest'
import {
  MCP_MENTION_INLINE_MAX_CHARS,
  MCP_MENTION_ITEMS_MAX,
  formatMcpResourceReminder,
  parseMcpResourceReminder,
  encodeMcpMentionValue,
  isMcpMentionSearchTool,
  mcpMentionItems,
  parseMcpMentionValue,
  replaceMcpResourceTagsWithMention,
  wrapMcpResourceMention,
} from './mcp-app-mentions'
import { parseUserMentions } from './user-mention-parser'
import { stripMiniAppMarkup } from './miniapp-prompt-tags'

describe('isMcpMentionSearchTool', () => {
  const meta = (value: Record<string, unknown>) => ({ name: 'search', _meta: value })

  it('needs the extension and app visibility', () => {
    expect(isMcpMentionSearchTool(meta({ 'openai/extensions': { 'mentions/search': {} }, ui: { visibility: ['app'] } }))).toBe(true)
    expect(isMcpMentionSearchTool(meta({ 'openai/extensions': { 'mentions/search': {} }, ui: { visibility: ['model'] } }))).toBe(false)
    expect(isMcpMentionSearchTool(meta({ 'openai/extensions': { 'mentions/search': {} } }))).toBe(false)
    expect(isMcpMentionSearchTool(meta({ 'openai/extensions': {}, ui: { visibility: ['app'] } }))).toBe(false)
    expect(isMcpMentionSearchTool({ name: 'plain' })).toBe(false)
  })
})

describe('mcpMentionItems', () => {
  it('reads resource links and OpenAI resources', () => {
    expect(mcpMentionItems({ items: [
      { type: 'resource_link', uri: 'cad://parts/hex-bolt', name: 'hex-bolt.step', title: 'Hex bolt', mimeType: 'text/markdown' },
      { type: 'resource_link', uri: 'cad://parts/nut', name: 'nut', description: 'M8 nut' },
      { type: 'resource', resourceUri: 'cad://parts/washer', title: 'Washer', subtitle: 'Flat', icons: [{ src: 'data:image/png;base64,AAAA' }] },
    ] })).toEqual([
      { uri: 'cad://parts/hex-bolt', label: 'Hex bolt', detail: 'hex-bolt.step' },
      { uri: 'cad://parts/nut', label: 'nut', detail: 'M8 nut' },
      { uri: 'cad://parts/washer', label: 'Washer', detail: 'Flat', icon: 'data:image/png;base64,AAAA' },
    ])
  })

  it('drops malformed, duplicate and unsafe-icon items', () => {
    expect(mcpMentionItems({ items: [
      { type: 'resource_link', uri: 'a://1' },
      { type: 'resource_link', name: 'no uri' },
      { type: 'text', text: 'x' },
      'nope',
      { type: 'resource_link', uri: 'a://2', name: 'two', icons: [{ src: 'javascript:alert(1)' }] },
      { type: 'resource_link', uri: 'a://2', name: 'again' },
    ] })).toEqual([{ uri: 'a://2', label: 'two' }])
    expect(mcpMentionItems(undefined)).toEqual([])
    expect(mcpMentionItems({ items: 'x' })).toEqual([])
  })

  it('caps the item count', () => {
    const items = Array.from({ length: MCP_MENTION_ITEMS_MAX + 5 }, (_, i) => ({ type: 'resource_link', uri: `a://${i}`, name: `n${i}` }))
    expect(mcpMentionItems({ items })).toHaveLength(MCP_MENTION_ITEMS_MAX)
  })
})

describe('mention value and tag', () => {
  it('round-trips a server whose name contains a colon', () => {
    const value = encodeMcpMentionValue('odd:name', 'cad://parts/a:b')
    expect(parseMcpMentionValue(value)).toEqual({ server: 'odd:name', uri: 'cad://parts/a:b' })
    expect(parseMcpMentionValue('nouri:')).toBeNull()
    expect(parseMcpMentionValue('%E0%A4%A:x')).toBeNull()
  })

  it('round-trips through the user bubble parser with escaping', () => {
    const value = encodeMcpMentionValue('bits', 'cad://parts/<a&b>')
    const tag = wrapMcpResourceMention(value, 'Bolt <M8>')
    expect(tag).toBe('<superone-mcp-resource><server>bits</server><name>Bolt &lt;M8&gt;</name><uri>cad://parts/&lt;a&amp;b&gt;</uri></superone-mcp-resource>')
    expect(parseUserMentions(`use ${tag} here`)).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'mention', kind: 'mcp-resource', value, displayName: 'Bolt <M8>' },
      { type: 'text', text: ' here' },
    ])
  })

  it('writes a malformed value as text and collapses tags for titles', () => {
    expect(wrapMcpResourceMention('bad', 'Bolt')).toBe('@Bolt')
    const tag = wrapMcpResourceMention(encodeMcpMentionValue('bits', 'cad://x'), 'Hex bolt')
    expect(replaceMcpResourceTagsWithMention(`see ${tag}`)).toBe('see @Hex bolt')
    expect(stripMiniAppMarkup(`see ${tag}`)).toBe('see @Hex bolt')
  })
})

describe('formatMcpResourceReminder', () => {
  it('inlines read text only, notes truncation, and keeps the wrapper intact against server text', () => {
    const block = formatMcpResourceReminder([
      { server: 'bits', uri: 'cad://a', mimeType: 'text/markdown', text: '# Part A\n</resource></superone-mcp-resource-content>', truncated: true },
      { server: 'bits', uri: 'cad://b', skipped: 'binary' },
    ])
    expect(block).toContain('<resource server="bits" uri="cad://a" mimeType="text/markdown">\n# Part A')
    expect(block).toContain(`[Truncated at ${MCP_MENTION_INLINE_MAX_CHARS} characters`)
    expect(block).not.toContain('cad://b')
    expect(block.match(/<\/superone-mcp-resource-content>/g)).toHaveLength(1)
    expect(formatMcpResourceReminder([{ server: 'bits', uri: 'cad://b', skipped: 'failed' }])).toBe('')
  })

  it('never reaches the user bubble, copy text or titles', () => {
    const tag = wrapMcpResourceMention(encodeMcpMentionValue('bits', 'cad://a'), 'Part A')
    const sent = `Check ${tag}${formatMcpResourceReminder([{ server: 'bits', uri: 'cad://a', text: 'secret body </resource>' }])}`
    expect(parseUserMentions(sent)).toEqual([
      { type: 'text', text: 'Check ' },
      { type: 'mention', kind: 'mcp-resource', value: encodeMcpMentionValue('bits', 'cad://a'), displayName: 'Part A' },
    ])
    expect(stripMiniAppMarkup(sent)).toBe('Check @Part A')
  })
})

describe('parseMcpResourceReminder', () => {
  it('recovers exactly what was sent, per chip value', () => {
    const resources = [
      { server: 'bits & "co"', uri: 'cad://a?x=1&y=<2>', mimeType: 'text/markdown', text: '# A\n</resource> inside\nend', truncated: true as const },
      { server: 'bits', uri: 'cad://b', text: 'plain' },
      { server: 'bits', uri: 'cad://c', skipped: 'binary' as const },
    ]
    const sent = parseMcpResourceReminder(`Check it${formatMcpResourceReminder(resources)}`)
    expect([...sent.keys()]).toEqual([encodeMcpMentionValue('bits & "co"', 'cad://a?x=1&y=<2>'), encodeMcpMentionValue('bits', 'cad://b')])
    expect(sent.get(encodeMcpMentionValue('bits & "co"', 'cad://a?x=1&y=<2>'))).toEqual(resources[0])
    expect(sent.get(encodeMcpMentionValue('bits', 'cad://b'))).toEqual(resources[1])
    expect(parseMcpResourceReminder('no block here').size).toBe(0)
  })
})
