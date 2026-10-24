import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createClaudeAgentEventMapper } from './agent-event-mapper'
import { mcpResourceLinks, toolResultResourceLinks } from './resource-links'

const report = { uri: 'file:///tmp/q4.pdf', name: 'q4.pdf', title: 'Q4 report', mimeType: 'application/pdf', size: 2048 }

describe('mcpResourceLinks', () => {
  it('keeps well-formed links and drops the rest', () => {
    expect(mcpResourceLinks([report, { uri: '', name: 'x' }, { name: 'no uri' }, null, { uri: 'cad://a', name: 'a', size: -1, title: '' }]))
      .toEqual([report, { uri: 'cad://a', name: 'a' }])
  })

  it('is undefined when nothing usable remains', () => {
    expect(mcpResourceLinks(undefined)).toBeUndefined()
    expect(mcpResourceLinks([{ name: 'no uri' }])).toBeUndefined()
    expect(toolResultResourceLinks('text result')).toBeUndefined()
  })
})

describe('resource links in the Claude event mapper', () => {
  it('puts an MCP result\'s links on its tool_result and a backgrounded call\'s on its notification', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event) })

    mapper.apply({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'mcp-1', name: 'mcp__reports__export', input: {} }] } })
    mapper.apply({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'mcp-1', content: 'Exported q4.pdf' }] },
      tool_use_result: { content: 'Exported q4.pdf', resourceLinks: [report] },
    })
    mapper.apply({ type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: 'mcp-2', status: 'completed', output_file: '', summary: 'done', resource_links: [report] })

    expect(events.find((event) => event.type === 'content_delta' && event.delta.type === 'tool_result'))
      .toMatchObject({ delta: { toolUseId: 'mcp-1', resourceLinks: [report] } })
    expect(events.find((event) => event.type === 'task_notification'))
      .toMatchObject({ toolUseId: 'mcp-2', resourceLinks: [report] })
  })
})
