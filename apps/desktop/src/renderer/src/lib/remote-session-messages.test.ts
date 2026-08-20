/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  nodePendingInteractionFields,
  nodePendingToPermissionRequest,
  nodePendingToQuestionRequest,
  nodePendingToPlanApprovalRequest,
  nodeSnapshotNeedsLiveDrain,
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

describe('node pending question/plan + live drain helpers', () => {
  it('maps question and plan to store-shaped requests', () => {
    const q = nodePendingToQuestionRequest({
      interactionId: 'q1',
      kind: 'question',
      input: {
        questions: [{ question: 'Go?', header: 'Confirm', options: [{ label: 'Yes' }] }],
      },
    })
    expect(q?.requestId).toBe('q1')
    expect(q?.questions[0]?.question).toBe('Go?')

    const p = nodePendingToPlanApprovalRequest({
      interactionId: 'pl1',
      kind: 'plan',
      input: { plan: 'Ship it' },
    })
    expect(p).toEqual(
      expect.objectContaining({
        requestId: 'pl1',
        planContent: 'Ship it',
      }),
    )
  })

  it("carries the node's own previewFormat so an HTML option preview renders", () => {
    const base = {
      interactionId: 'q1',
      kind: 'question' as const,
      input: {
        questions: [{ question: 'Go?', header: 'Confirm', options: [{ label: 'Yes', preview: '<b>hi</b>' }] }],
      },
    }
    // Absent → undefined (markdown default), unknown value → dropped, 'html' → kept.
    expect(nodePendingToQuestionRequest(base)?.previewFormat).toBeUndefined()
    expect(
      nodePendingToQuestionRequest({ ...base, input: { ...base.input, previewFormat: 'pdf' } })?.previewFormat,
    ).toBeUndefined()
    expect(
      nodePendingToQuestionRequest({ ...base, input: { ...base.input, previewFormat: 'html' } })?.previewFormat,
    ).toBe('html')
  })

  it('builds interaction fields and live-drain flags', () => {
    const fields = nodePendingInteractionFields({
      interactionId: 'q1',
      kind: 'question',
      input: { questions: [{ question: 'Go?' }] },
    })
    expect(fields.pendingQuestion?.requestId).toBe('q1')
    expect(fields.awaitingAssistantReply).toBe(true)
    expect(nodeSnapshotNeedsLiveDrain({ status: 'streaming' })).toBe(true)
    expect(nodeSnapshotNeedsLiveDrain({ status: 'idle', pendingInteraction: null })).toBe(false)
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

  const localAssistantWithTools = (id: string, text = 'working'): ChatMessage => ({
    id,
    role: 'assistant',
    status: 'complete',
    content: [
      { type: 'text', text },
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

  const localAssistantText = (
    id: string,
    text: string,
    status: ChatMessage['status'] = 'complete',
  ): ChatMessage => ({
    id,
    role: 'assistant',
    status,
    content: [{ type: 'text', text }],
    createdAt: new Date(2).toISOString(),
    providerId: 'claude',
  })

  it('keeps streamed tool_use + tool_result when end-of-turn transcript is text-only', () => {
    // Assistant id is shared (SessionRuntime assistantId → stream + transcript).
    // User ids still diverge (clientMessageId vs node blockId).
    const asstId = 'asst-uuid-shared'
    const local: ChatMessage[] = [
      localUser('client-user-uuid', 'list files'),
      localAssistantWithTools(asstId),
    ]
    const transcript = [
      { id: 'node-user-block', role: 'user', text: 'list files', createdAt: 1 },
      { id: asstId, role: 'assistant', text: 'working', createdAt: 2 },
    ]

    const merged = reconcileTranscriptWithLocalMessages(local, transcript, 'claude')

    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).toBe('client-user-uuid')
    expect(merged[1]!.id).toBe(asstId)
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
    expect(merged[1]!.id).toBe('node-asst')
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

  it('preserves an interrupted local assistant and still matches the next success by id', () => {
    // Interrupted/error turns never push to transcript; local still has the bubble.
    // Role-index would pair interrupted asst with the next success row — wrong.
    const interruptedId = 'asst-interrupted'
    const successId = 'asst-success'
    const local: ChatMessage[] = [
      localUser('client-u1', 'first'),
      localAssistantText(interruptedId, 'partial…', 'interrupted'),
      localUser('client-u2', 'second'),
      localAssistantWithTools(successId, 'done with tools'),
    ]
    const transcript = [
      { id: 'node-u1', role: 'user', text: 'first', createdAt: 1 },
      // no interrupted assistant on node
      { id: 'node-u2', role: 'user', text: 'second', createdAt: 3 },
      { id: successId, role: 'assistant', text: 'done with tools', createdAt: 4 },
    ]

    const merged = reconcileTranscriptWithLocalMessages(local, transcript, 'claude')

    expect(merged.map((m) => m.id)).toEqual([
      'client-u1',
      interruptedId,
      'client-u2',
      successId,
    ])
    expect(merged[1]!.status).toBe('interrupted')
    expect(merged[3]!.content.map((b) => b.type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
    ])
  })
})
