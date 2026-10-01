import { describe, expect, it } from 'vitest'
import { mcpAppContent, mcpAppMessagePreview, mcpAppMessageTarget } from './mcp-apps-content'
import { parseMessageDisplay } from './message-display'

describe('MCP App rich message content', () => {
  it('keeps titles out of model text and labels selected text/resources in display chips', () => {
    const result = mcpAppContent([
      { type: 'text', text: 'Compare these', _meta: { private: 'secret' } },
      { type: 'text', text: '{"part":"dial"}', _meta: { 'openai/title': 'Agent dial', private: 'secret' } },
      { type: 'resource_link', uri: 'file:///parts/dial.stl', name: 'dial.stl', _meta: { 'openai/title': 'CAD source' } },
      { type: 'resource', resource: { uri: 'data:part', text: 'part details', _meta: { secret: 'private' } } },
    ], 'CAD', 'mcp:message')
    expect(result.text).toBe('Compare these\n{"part":"dial"}\ndial.stl\nfile:///parts/dial.stl\ndata:part\npart details')
    expect(result.text).not.toMatch(/secret|private|Agent dial|CAD source/)
    expect(result.userMessageContent).toEqual([{ type: 'text', text: 'Compare these' }])
    expect(result.contexts.map(item => item.summary)).toEqual(['Agent dial', 'CAD source', 'Resource'])
    expect(parseMessageDisplay(result)).toEqual({ userMessageContent: result.userMessageContent, contexts: result.contexts })
  })

  it('uses the real image/document input for image and embedded binary blocks', () => {
    const result = mcpAppContent([
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', _meta: { 'openai/title': 'Drawing', private: 'secret' } },
      { type: 'resource', resource: { uri: 'file:///part.pdf', mimeType: 'application/pdf', blob: 'JVBERi0xLjQK' }, _meta: { 'openai/title': 'Part manual' } },
    ], 'CAD', 'mcp:message')
    expect(result.images).toEqual([{ id: 'mcp:message:0', name: 'Drawing', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }, { id: 'mcp:message:1', name: 'Part manual', mimeType: 'application/pdf', base64: 'JVBERi0xLjQK' }])
    expect(result.text).toBe('file:///part.pdf')
    expect(result.userMessageContent).toEqual([{ type: 'image', name: 'Drawing', id: 'mcp:message:0' }, { type: 'document', name: 'Part manual', id: 'mcp:message:1' }])
    expect(parseMessageDisplay(result).userMessageContent).toEqual(result.userMessageContent)
  })

  it('retains opaque embedded resources without private metadata and rejects invalid image input before confirmation', () => {
    const result = mcpAppContent([{ type: 'resource', resource: { uri: 'data:model', blob: 'YmluYXJ5', _meta: { private: 'secret' } } }], 'CAD', 'mcp:m')
    expect(JSON.parse(result.text)).toEqual({ uri: 'data:model', byteSize: 6 })
    expect(result.images).toEqual([])
    expect(result.contexts[0]?.content).not.toContain('YmluYXJ5')
    expect(() => mcpAppMessagePreview({ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'invalid' }] }, 'CAD')).toThrow('invalid base64')
  })

  it('summarizes a large opaque binary resource instead of embedding base64 in the prompt', () => {
    const blob = 'Ymlu'.repeat(150_000)
    const result = mcpAppContent([{ type: 'resource', resource: { uri: 'file:///part.stl', mimeType: 'application/octet-stream', blob }, _meta: { 'openai/title': 'CAD source' } }], 'CAD', 'mcp:blob')
    expect(JSON.parse(result.text)).toEqual({ uri: 'file:///part.stl', mimeType: 'application/octet-stream', byteSize: 450_000 })
    expect(result.text.length).toBeLessThan(150)
    expect(result.contexts[0].summary).toBe('CAD source')
    expect(result.text).not.toContain(blob)
  })

  it('uses titles rather than raw payloads in a bounded confirmation preview', () => {
    const params = { role: 'user' as const, content: [{ type: 'text' as const, text: 'x'.repeat(9000), _meta: { 'openai/title': 'Long part', 'openai/thumbnail': { src: 'file:///private.png' } } }], _meta: { 'openai/message': { target: 'new' } } }
    const preview = mcpAppMessagePreview(params, 'CAD')
    expect(preview.text).toBe('')
    expect(preview.target).toBe('new')
    expect(preview.items[0]).toMatchObject({ title: 'Long part' })
    expect(new TextEncoder().encode(preview.items[0].content).byteLength).toBeLessThanOrEqual(4096)
    expect(preview.items[0].thumbnail).toBeUndefined()
  })

  it('defaults to active and refuses send:false, malformed targets and unsupported audio', () => {
    const params = { role: 'user' as const, content: [] }
    expect(mcpAppMessageTarget(params)).toBe('active')
    for (const options of [{ send: false }, { target: 'other' }, { target: 'active', extra: true }, null, []]) {
      expect(() => mcpAppMessageTarget({ ...params, _meta: { 'openai/message': options } })).toThrow()
    }
    expect(() => mcpAppContent([{ type: 'audio' }], 'CAD', 'mcp:m')).toThrow('not supported')
    expect(() => parseMessageDisplay({ userMessageContent: [{ type: 'tool_use', toolName: 'forged' }] })).toThrow()
  })
})
