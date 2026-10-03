import { expect, it } from 'vitest'
import type { AgentEvent, CodexCollabToolCallItem, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import { applyMcpAppsCatalogEvents } from './mcp-apps-catalog'

it('replays a child attachment and host updates before the parent transcript row is committed', () => {
  const child: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'fixture', tool: 'next', arguments: {}, status: 'completed', app: { appInstanceId: 'child-view', binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'cfg' }, origin: { providerSessionId: 'child' }, resourceUri: 'ui://fixture/view', status: 'result' } }
  const item: CodexCollabToolCallItem = { id: 'spawn', type: 'collab_tool_call', tool: 'spawnAgent', status: 'completed', receiverThreadIds: ['child'], agentsStates: {}, childItems: { child: [child] } }
  const resource = { hash: 'a'.repeat(64), meta: {} }
  const events: AgentEvent[] = [
    { type: 'codex_item_delta', messageId: 'm', phase: 'updated', item },
    { type: 'mcp_app_updated', messageId: 'm', appInstanceId: 'child-view', update: { resource, modelContext: null } },
    { type: 'codex_item_delta', messageId: 'm', phase: 'completed', item: { ...item, childItems: undefined } },
  ]
  const envelopes: EnvironmentEventEnvelope[] = events.map((event, i) => ({ eventId: String(i), sequence: String(i), timestamp: i, aggregateType: 'session', aggregateId: 's', eventType: SESSION_DURABLE_EVENT.agentEvent, eventVersion: 1, environmentId: 'node', payload: { event } }))
  const catalog = applyMcpAppsCatalogEvents([], envelopes, 's', new Map())
  expect(catalog).toHaveLength(1)
  expect(findMcpAppAttachment(catalog, 'child-view')).toMatchObject({ messageId: 'm', app: { resource, modelContext: null, origin: { providerSessionId: 'child' } } })
})
