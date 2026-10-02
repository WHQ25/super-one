import { describe, expect, it, vi } from 'vitest'
import {
  MCP_MENTION_INLINE_MAX_CHARS, MCP_MENTION_READ_MAX, createMcpMentionPreviewCache, encodeMcpMentionValue, mcpMentionCardStatus,
  mcpMentionPreviewState, mcpResourceTargets, wrapMcpResourceMention,
} from './mcp-app-mentions'

describe('mcpResourceTargets', () => {
  it('names every tagged resource in order, capped at the read limit', () => {
    const tag = (n: number) => wrapMcpResourceMention(encodeMcpMentionValue('bits', `cad://${n}`), `Part ${n}`)
    const text = `see ${Array.from({ length: MCP_MENTION_READ_MAX + 2 }, (_, n) => tag(n)).join(' ')}`
    const targets = mcpResourceTargets(text)
    expect(targets).toHaveLength(MCP_MENTION_READ_MAX)
    expect(targets[0]).toEqual({ server: 'bits', uri: 'cad://0' })
    expect(mcpResourceTargets('plain @text')).toEqual([])
  })
})

describe('chip card status', () => {
  it('reports what was inlined, truncated, or only linked', () => {
    expect(mcpMentionCardStatus({ status: 'loading' })).toEqual({ line: 'loading', count: 0 })
    expect(mcpMentionCardStatus({ status: 'read', resource: { server: 's', uri: 'u', text: 'abc' } })).toEqual({ line: 'content', count: 3 })
    expect(mcpMentionCardStatus({ status: 'read', resource: { server: 's', uri: 'u', text: 'a', truncated: true } }))
      .toEqual({ line: 'truncated', count: MCP_MENTION_INLINE_MAX_CHARS })
    expect(mcpMentionCardStatus({ status: 'read' })).toEqual({ line: 'linkOnly', count: 0 })
  })

  it('treats no answer or a refused read as a failed preview', () => {
    expect(mcpMentionPreviewState(null)).toEqual({ status: 'failed' })
    expect(mcpMentionPreviewState({ server: 's', uri: 'u', skipped: 'failed' })).toEqual({ status: 'failed' })
    expect(mcpMentionPreviewState({ server: 's', uri: 'u', skipped: 'binary' })).toMatchObject({ status: 'read' })
  })
})

describe('createMcpMentionPreviewCache', () => {
  it('reuses a read for 30 s and forgets one that found nothing', async () => {
    let now = 0
    const cache = createMcpMentionPreviewCache(() => now)
    const read = vi.fn(async () => ({ server: 's', uri: 'u', text: 'x' }))
    await cache('k', read)
    await cache('k', read)
    expect(read).toHaveBeenCalledTimes(1)
    now = 30_000
    await cache('k', read)
    expect(read).toHaveBeenCalledTimes(2)

    const missing = vi.fn(async () => null)
    await cache('gone', missing)
    await Promise.resolve()
    await cache('gone', missing)
    expect(missing).toHaveBeenCalledTimes(2)
  })
})
