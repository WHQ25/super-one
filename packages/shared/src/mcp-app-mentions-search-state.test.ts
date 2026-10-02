import { describe, expect, it } from 'vitest'
import {
  MCP_MENTION_SEARCH_IDLE, mcpMentionHasStatus, mcpMentionSearchAnswered, mcpMentionSearchFailed, mcpMentionSearchStarted,
  type McpMentionSource,
} from './mcp-app-mentions'

const source = (server: string, items: McpMentionSource['items'] = []): McpMentionSource =>
  ({ server, tool: 'search', title: server, items })
const item = { uri: 'cad://a', label: 'A' }

describe('MCP mention search state', () => {
  it('shows the sections a session answered with last time as soon as a new search starts', () => {
    mcpMentionSearchAnswered('s-known', { sources: [source('bits', [item])] })
    expect(mcpMentionSearchStarted('s-known', MCP_MENTION_SEARCH_IDLE)).toEqual({
      sources: [source('bits')], loading: true, incomplete: false, failed: false,
    })
  })

  it('does not remember an incomplete answer, which may be missing servers', () => {
    mcpMentionSearchAnswered('s-partial', { sources: [source('bits')], incomplete: true })
    expect(mcpMentionSearchStarted('s-partial', MCP_MENTION_SEARCH_IDLE).sources).toEqual([])
  })

  it('keeps the items on screen while the next query is in flight', () => {
    const answered = mcpMentionSearchAnswered('s-typing', { sources: [source('bits', [item])] })
    expect(mcpMentionSearchStarted('s-typing', answered).sources).toEqual([source('bits', [item])])
  })

  it('drops stale items when the lookup fails', () => {
    const answered = mcpMentionSearchAnswered('s-fail', { sources: [source('bits', [item])] })
    expect(mcpMentionSearchFailed(answered)).toEqual({ sources: [source('bits')], loading: false, incomplete: false, failed: true })
  })

  it('keeps the popup open for a quiet section, a failure or missing servers, not for listed items alone', () => {
    expect(mcpMentionHasStatus(MCP_MENTION_SEARCH_IDLE)).toBe(false)
    expect(mcpMentionHasStatus({ ...MCP_MENTION_SEARCH_IDLE, sources: [source('bits', [item])] })).toBe(false)
    expect(mcpMentionHasStatus({ ...MCP_MENTION_SEARCH_IDLE, sources: [source('bits')], loading: true })).toBe(true)
    expect(mcpMentionHasStatus({ ...MCP_MENTION_SEARCH_IDLE, sources: [{ ...source('bits'), failed: true }] })).toBe(true)
    expect(mcpMentionHasStatus({ ...MCP_MENTION_SEARCH_IDLE, incomplete: true })).toBe(true)
  })
})
