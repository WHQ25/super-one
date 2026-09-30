import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createClaudeAgentEventMapper } from './agent-event-mapper'
import { ClaudeMcpAppsCatalog, ClaudeToolApps } from './mcp-apps'

function mapperWithApps() {
  const events: AgentEvent[] = []
  const catalog = new ClaudeMcpAppsCatalog()
  catalog.update([{ name: 'fixture', tools: [{ name: 'list', _meta: { ui: { resourceUri: 'ui://fixture/items.html' } } }] }])
  const toolApps = new ClaudeToolApps({
    catalog,
    binding: (server) => ({ node: 'node-1', session: 'sess-1', server, configGeneration: 0, configFingerprint: 'fp' }),
    providerSessionId: () => 'claude-sid',
  })
  const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event), toolApps })
  const deltas = () => events.flatMap((e) => (e.type === 'content_delta' ? [e.delta] : []))
  return { mapper, deltas }
}

describe('createClaudeAgentEventMapper with MCP Apps', () => {
  it('carries the app attachment on the UI tool row from tool_use to tool_result', () => {
    const { mapper, deltas } = mapperWithApps()
    mapper.apply({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__fixture__list', input: { page: 2 } }] },
    })
    mapper.apply({
      type: 'user',
      uuid: 'u1',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"page":2}' }] },
      tool_use_result: { content: '{"page":2}', structuredContent: { page: 2 }, _meta: { secret: 1 } },
    })

    const [use, result] = deltas()
    expect(use).toMatchObject({ type: 'tool_use', app: { harnessCallId: 'tu1', status: 'pending', toolInput: { page: 2 } } })
    expect(result).toMatchObject({
      type: 'tool_result',
      summary: '{"page":2}',
      app: { status: 'result', toolResult: { structuredContent: { page: 2 }, _meta: { secret: 1 } } },
    })
  })

  it('leaves ordinary tool rows untouched', () => {
    const { mapper, deltas } = mapperWithApps()
    mapper.apply({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls' } }] } })
    mapper.apply({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'a' }] } })
    expect(deltas().every((d) => !('app' in d))).toBe(true)
  })
})
