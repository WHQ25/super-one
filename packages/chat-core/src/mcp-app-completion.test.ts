import { expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexCollabToolCallItem, CodexMcpToolCallItem, CodexThreadItem } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import { codexContentEvents } from '@superone/shared/test-fixtures/codex-content'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

/** The content deltas that move a Codex item from its first snapshot to its last. */
function codexUpdate(first: CodexThreadItem, last: CodexThreadItem): [AgentEvent[], AgentEvent[]] {
  const started = codexContentEvents('m', first)
  return [started, codexContentEvents('m', first, last).slice(started.length)]
}

it.each(['claude', 'codex'] as const)('preserves host state through %s result and completion replay', harness => {
  const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad', status: 'pending' }
  const item: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'cad', tool: 'library', arguments: {}, status: 'in_progress', app }
  const completed = { ...item, status: 'completed' as const, app: { ...app, status: 'result' as const, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' as const } } }
  const [started, finished] = codexUpdate(item, completed)
  const message: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: harness, content: harness === 'claude' ? [{ type: 'tool_use', toolUseId: 'call', toolName: 'cad.library', input: '{}', status: 'streaming', app }] : [], ...(harness === 'codex' ? { metadata: { codex: { threadId: 'thread', usage: null, items: [] } } } : {}) }
  let session = { ...createDefaultChatCoreSession(), messages: [message] }
  const apply = (...events: AgentEvent[]) => { for (const event of events) session = { ...session, ...applyEventToSession(session, event) } }
  if (harness === 'codex') apply(...started)
  const update = { resource: { hash: 'a'.repeat(64), meta: {} }, presentation: { toolTitle: 'Host title' }, modelContext: null }
  apply({ type: 'mcp_app_updated', messageId: 'm', appInstanceId: 'view', update })
  if (harness === 'codex') apply(...finished)
  else apply({ type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'call', summary: 'done', app: completed.app } })
  apply({ type: 'message_complete', messageId: 'm', ...(harness === 'codex' ? { metadata: { codex: { finalResponse: 'done', threadId: 'thread', usage: null, items: [] } } } : {}) })
  expect(findMcpAppAttachment(session.messages, 'view')?.app).toMatchObject({ ...update, status: 'result', toolResultOmitted: { reason: 'size_limit' } })
})

it('preserves child View host updates through a collab update and completion', () => {
  const app: ToolAppAttachment = { appInstanceId: 'child-view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'child' }, resourceUri: 'ui://cad', status: 'pending' }
  const child: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'cad', tool: 'library', arguments: {}, status: 'in_progress', app }
  const item: CodexCollabToolCallItem = { id: 'spawn', type: 'collab_tool_call', tool: 'spawnAgent', receiverThreadIds: ['child'], agentsStates: {}, status: 'completed', childItems: { child: [child] } }
  const [started, finished] = codexUpdate(item, { ...item, childItems: { child: [{ ...child, status: 'completed', app: { ...app, status: 'result' } }] } })
  const message: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', content: [], providerId: 'codex', metadata: { codex: { threadId: 'root', usage: null, items: [] } } }
  let session = { ...createDefaultChatCoreSession(), messages: [message] }
  const apply = (...events: AgentEvent[]) => { for (const event of events) session = { ...session, ...applyEventToSession(session, event) } }
  apply(...started)
  const update = { resource: { hash: 'a'.repeat(64), meta: {} }, presentation: { toolTitle: 'Child library' }, modelContext: null }
  apply({ type: 'mcp_app_updated', messageId: 'm', appInstanceId: 'child-view', update })
  apply(...finished)
  expect(findMcpAppAttachment(session.messages, 'child-view')?.app).toMatchObject({ ...update, status: 'result' })
  apply({ type: 'message_complete', messageId: 'm', metadata: { codex: { finalResponse: 'done', threadId: 'root', usage: null, items: [] } } })
  expect(findMcpAppAttachment(session.messages, 'child-view')?.app).toMatchObject({ ...update, status: 'result' })
})
