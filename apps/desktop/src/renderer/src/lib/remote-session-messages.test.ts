/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  nodePendingToPermissionRequest,
  nodeStatusToAgentStatus,
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
