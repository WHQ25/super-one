import { expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

it.each(['claude', 'codex'] as const)('preserves host state through %s result and completion replay', harness => {
  const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad', status: 'pending' }
  const item: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'cad', tool: 'library', arguments: {}, status: 'in_progress', app }
  const message: ChatMessage = { id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: harness, content: harness === 'claude' ? [{ type: 'tool_use', toolUseId: 'call', toolName: 'cad.library', input: '{}', status: 'streaming', app }] : [], ...(harness === 'codex' ? { metadata: { codex: { threadId: 'thread', usage: null, items: [item] } } } : {}) }
  let session = { ...createDefaultChatCoreSession(), messages: [message] }
  const apply = (event: AgentEvent) => { session = { ...session, ...applyEventToSession(session, event) } }
  const update = { resource: { hash: 'a'.repeat(64), meta: {} }, presentation: { toolTitle: 'Host title' }, modelContext: null }
  apply({ type: 'mcp_app_updated', messageId: 'm', appInstanceId: 'view', update })
  const completed = { ...item, status: 'completed' as const, app: { ...app, status: 'result' as const, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' as const } } }
  if (harness === 'codex') apply({ type: 'codex_item_delta', messageId: 'm', phase: 'completed', item: completed })
  else apply({ type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'call', summary: 'done', app: completed.app } })
  apply({ type: 'message_complete', messageId: 'm', ...(harness === 'codex' ? { metadata: { codex: { finalResponse: 'done', threadId: 'thread', usage: null, items: [{ ...completed, app: undefined }] } } } : {}) })
  expect(findMcpAppAttachment(session.messages, 'view')?.app).toMatchObject({ ...update, status: 'result', toolResultOmitted: { reason: 'size_limit' } })
})
