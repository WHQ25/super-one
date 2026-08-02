/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  nodePendingToPermissionRequest,
  nodeStatusToAgentStatus,
  reconcileTranscriptWithLocalMessages,
  transcriptToChatMessages,
} from './remote-session-messages'

describe('nodePendingToPermissionRequest', () => {
  it('maps permission interactions to PermissionRequest', () => {
    const req = nodePendingToPermissionRequest({
      interactionId: 'i1',
      kind: 'permission',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls' },
      createdAt: 1,
    })
    expect(req).toEqual({
      requestId: 'i1',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'ls' },
      allowAlwaysAllow: true,
    })
  })

  it('ignores non-permission kinds and empty ids', () => {
    expect(
      nodePendingToPermissionRequest({
        interactionId: 'q1',
        kind: 'question',
        createdAt: 1,
      }),
    ).toBeNull()
    expect(nodePendingToPermissionRequest(null)).toBeNull()
  })
})

describe('transcript helpers', () => {
  it('maps transcript and status', () => {
    expect(
      transcriptToChatMessages([
        { id: 'u1', role: 'user', text: 'hi', createdAt: 1 },
        { id: 'a1', role: 'assistant', text: 'yo', createdAt: 2 },
      ]).map((m) => m.role),
    ).toEqual(['user', 'assistant'])
    expect(nodeStatusToAgentStatus('streaming')).toBe('streaming')
    expect(nodeStatusToAgentStatus('idle')).toBe('idle')
  })
})

describe('reconcileTranscriptWithLocalMessages', () => {
  const localUser = (id: string, text: string): ChatMessage => ({
    id,
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date(1).toISOString(),
    providerId: 'claude',
  })

  const localAssistantWithTools = (id: string): ChatMessage => ({
    id,
    role: 'assistant',
    status: 'complete',
    content: [
      { type: 'text', text: 'working' },
      {
        type: 'tool_use',
        toolUseId: 'tu-1',
        toolName: 'Bash',
        input: '{"command":"ls"}',
        status: 'complete',
      },
      {
        type: 'tool_result',
        toolUseId: 'tu-1',
        summary: 'file.txt',
      },
    ],
    createdAt: new Date(2).toISOString(),
    providerId: 'claude',
  })

  it('keeps streamed tool_use + tool_result when end-of-turn transcript is text-only', () => {
    // Node blockIds differ from client / sticky mapper ids — match by role-index, not id.
    const local: ChatMessage[] = [
      localUser('client-user-uuid', 'list files'),
      localAssistantWithTools('assistant-sess-sticky'),
    ]
    const transcript = [
      { id: 'node-user-block', role: 'user', text: 'list files', createdAt: 1 },
      { id: 'node-asst-block', role: 'assistant', text: 'working', createdAt: 2 },
    ]

    const merged = reconcileTranscriptWithLocalMessages(local, transcript, 'claude')

    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).toBe('client-user-uuid')
    expect(merged[1]!.id).toBe('assistant-sess-sticky')
    expect(merged[1]!.content.map((b) => b.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
    ])
  })

  it('fills in a message present only in the transcript when the stream missed it', () => {
    const local: ChatMessage[] = [localUser('client-user-uuid', 'hi')]
    const transcript = [
      { id: 'node-user', role: 'user', text: 'hi', createdAt: 1 },
      { id: 'node-asst', role: 'assistant', text: 'hello from node', createdAt: 2 },
    ]

    const merged = reconcileTranscriptWithLocalMessages(local, transcript, 'claude')

    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).toBe('client-user-uuid')
    expect(merged[1]!.role).toBe('assistant')
    expect(merged[1]!.content).toEqual([{ type: 'text', text: 'hello from node' }])
  })

  it('uses transcript fully when local is empty (session resume)', () => {
    const transcript = [
      { id: 'u1', role: 'user', text: 'hi', createdAt: 1 },
      { id: 'a1', role: 'assistant', text: 'yo', createdAt: 2 },
    ]
    const merged = reconcileTranscriptWithLocalMessages([], transcript, 'codex')
    expect(merged.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(merged[0]!.id).toBe('u1')
  })

  it('keeps local when transcript is empty', () => {
    const local = [localUser('u', 'x')]
    expect(reconcileTranscriptWithLocalMessages(local, undefined, 'claude')).toEqual(local)
    expect(reconcileTranscriptWithLocalMessages(local, [], 'claude')).toEqual(local)
  })
})
