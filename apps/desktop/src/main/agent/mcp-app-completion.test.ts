import { expect, it } from 'vitest'
import type { ChatMessage, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { findMcpAppAttachment, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'
import { applyCodexEventToRuntime, finalizeCodexAssistantMessage, type CodexSessionRuntime } from './codex-session-runtime'
import { applyClaudeEventToRuntime, type ClaudeSessionRuntime } from './claude-session-runtime'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad', status: 'pending' }
const hostState = { resource: { hash: 'a'.repeat(64), meta: { prefersBorder: true } }, presentation: { toolTitle: 'Host title' }, modelContext: { updateId: 'u', content: [{ type: 'text' as const, text: 'Selection' }], source: { appInstanceId: 'view', server: 'cad' } } }
const message: ChatMessage = { id: 'm', role: 'assistant', providerId: 'codex', status: 'streaming', content: [], createdAt: '' }
const item: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'cad', tool: 'library', arguments: {}, status: 'in_progress', app }

it('keeps host resource/context/presentation through Codex streaming and final completion snapshots', () => {
  let runtime: CodexSessionRuntime = { projectPath: '/project', sessionId: 's', messages: [{ ...message, metadata: { codex: { threadId: 'thread', usage: null, items: [item] } } }], totalCostUsd: 0, contextTokens: 0, gitBranch: null, worktreePath: null, streamingTokensByMessageId: {}, lastUsageByMessageId: {} }
  runtime.messages = updateMcpAppAttachments(runtime.messages, 'view', hostState)
  const completed: CodexMcpToolCallItem = { ...item, status: 'completed', app: { ...app, status: 'result', toolResultOmitted: { bytes: 1050849, reason: 'size_limit' } } }
  runtime = applyCodexEventToRuntime(runtime, { type: 'codex_item_delta', messageId: 'm', phase: 'completed', item: completed })
  expect(findMcpAppAttachment(runtime.messages, 'view')?.app).toMatchObject(hostState)
  runtime = finalizeCodexAssistantMessage(runtime, { messageId: 'm', status: 'complete', text: 'done', result: { threadId: 'thread', finalResponse: 'done', items: [{ ...completed, app: undefined }], usage: null } })
  expect(findMcpAppAttachment(runtime.messages, 'view')?.app).toMatchObject({ ...hostState, status: 'result', toolResultOmitted: { reason: 'size_limit' } })
})

it('keeps host resource/context/presentation through Claude result and completion events', () => {
  let runtime: ClaudeSessionRuntime = { projectPath: '/project', sessionId: 's', messages: [{ ...message, providerId: 'claude', content: [{ type: 'tool_use', toolUseId: 'call', toolName: 'cad.library', input: '{}', status: 'streaming', app }] }], totalCostUsd: 0, contextTokens: 0, gitBranch: null, worktreePath: null, taskProgress: {}, session: null }
  runtime.messages = updateMcpAppAttachments(runtime.messages, 'view', hostState)
  runtime = applyClaudeEventToRuntime(runtime, { type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'call', summary: 'done', app: { ...app, status: 'result' } } })
  runtime = applyClaudeEventToRuntime(runtime, { type: 'message_complete', messageId: 'm' })
  expect(findMcpAppAttachment(runtime.messages, 'view')?.app).toMatchObject({ ...hostState, status: 'result' })
})
