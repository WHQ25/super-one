import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { HarnessOperationHost, NodeSessionRecord } from '@superone/runtime/session'
import { dispatchNodeRewind, revertCodexThread, truncateBeforeCheckpoint } from './node-rewind'

function session(over: Partial<NodeSessionRecord> = {}): NodeSessionRecord {
  return {
    sessionId: 's1', projectId: 'p1', harnessId: 'codex', providerId: 'codex', title: null,
    status: 'idle', transcript: [], pendingInteraction: null, providerResume: null, cwd: null,
    createdAt: 0, updatedAt: 0, isPinned: false, isHidden: false, isUserRenamed: false,
    controllerClientSessionId: null, hostActionCapabilityVersion: 0, hostActionToolGroups: [],
    alwaysAllowedTools: [], ...over,
  }
}

function user(id: string, checkpointId = id): ChatMessage {
  return { id, role: 'user', status: 'complete', content: [], createdAt: '', providerId: 'codex', checkpointId }
}

function host(messages: ChatMessage[], onEvent = vi.fn()): HarnessOperationHost {
  return {
    messages,
    assertControl() {},
    onEvent,
    onQuestion: async () => ({}),
    onPermission: async () => 'allow',
  }
}

describe('node rewind dispatch', () => {
  it('keeps OpenCode on its native handler, including truncate', async () => {
    const opencode = vi.fn(async () => ({ canRewind: true }))
    const record = session({ harnessId: 'opencode' })
    const operationHost = host([])
    await dispatchNodeRewind({
      session: record, method: 'session.rewind', input: { mode: 'conversation', checkpointId: 'u1' },
      host: operationHost, opencode,
    })
    await dispatchNodeRewind({
      session: record, method: 'session.truncateAtCheckpoint', input: { checkpointId: 'u1' },
      host: operationHost, opencode,
    })
    expect(opencode).toHaveBeenCalledTimes(2)
    expect(operationHost.onEvent).not.toHaveBeenCalled()
  })

  it('refuses Antigravity before any Grok rewind', async () => {
    const rewindGrok = vi.fn()
    await expect(dispatchNodeRewind({
      session: session({ harnessId: 'acp', acpAgentId: 'antigravity' }),
      method: 'session.rewind', input: { mode: 'files', checkpointId: 'u1' },
      host: host([user('u1')]), rewindGrok,
    })).resolves.toMatchObject({ canRewind: false, error: 'Antigravity does not support rewind' })
    expect(rewindGrok).not.toHaveBeenCalled()
  })

  it('forwards Claude and Codex and indexes Grok prompts', async () => {
    const claude = vi.fn(async () => ({ canRewind: true }))
    const codex = vi.fn(async () => ({ canRewind: true }))
    const rewindGrok = vi.fn(async () => ({ canRewind: true }))
    const operationHost = host([user('u0'), user('u1')])
    await dispatchNodeRewind({
      session: session({ harnessId: 'claude' }), method: 'session.previewRewind', input: { checkpointId: 'u0' },
      host: operationHost, claude,
    })
    await dispatchNodeRewind({
      session: session({ harnessId: 'codex' }), method: 'session.rewind', input: { mode: 'conversation', checkpointId: 'u0' },
      host: operationHost, codex,
    })
    await dispatchNodeRewind({
      session: session({ harnessId: 'acp', acpAgentId: 'grok-build' }),
      method: 'session.rewind', input: { mode: 'code+chat', checkpointId: 'u1' },
      host: operationHost, rewindGrok,
    })
    expect(claude).toHaveBeenCalledOnce()
    expect(codex).toHaveBeenCalledOnce()
    expect(rewindGrok).toHaveBeenCalledWith({
      session: expect.objectContaining({ harnessId: 'acp' }), promptIndex: 1, mode: 'all',
    })
  })

  it('matches desktop answers for Cursor and DeepSeek file rewind', async () => {
    const cursor = await dispatchNodeRewind({
      session: session({ harnessId: 'cursor' }), method: 'session.previewRewind', input: { checkpointId: 'u1' },
      host: host([]),
    })
    const deepseek = await dispatchNodeRewind({
      session: session({ harnessId: 'dsh' }), method: 'session.rewind', input: { mode: 'files', checkpointId: 'u1' },
      host: host([]),
    })
    const chat = await dispatchNodeRewind({
      session: session({ harnessId: 'dsh' }), method: 'session.rewind', input: { mode: 'conversation', checkpointId: 'u1' },
      host: host([]),
    })
    expect(cursor).toMatchObject({ canRewind: false, error: expect.stringContaining('Cursor SDK') })
    expect(deepseek).toMatchObject({ canRewind: false, error: 'DeepSeek harness does not support rewind yet' })
    expect(chat).toEqual({ canRewind: true })
  })

  it('truncates strictly before the checkpoint', async () => {
    const messages = [user('u0'), user('u1')]
    expect(truncateBeforeCheckpoint(messages, 'u1')).toEqual([messages[0]])
    const onEvent = vi.fn()
    await expect(dispatchNodeRewind({
      session: session({ harnessId: 'claude' }), method: 'session.truncateAtCheckpoint', input: { checkpointId: 'u1' },
      host: host(messages, onEvent),
    })).resolves.toBe(true)
    expect(onEvent).toHaveBeenCalledWith({ type: 'transcript_replaced', messages: [messages[0]] })
    await expect(dispatchNodeRewind({
      session: session({ harnessId: 'claude' }), method: 'session.truncateAtCheckpoint', input: { checkpointId: 'missing' },
      host: host(messages),
    })).resolves.toBe(false)
  })
})

describe('revertCodexThread', () => {
  it('forks when revert only supports paginated threads', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/revert') throw new Error('thread/revert only supports paginated threads')
      return { thread: { id: 'forked' } }
    })
    await expect(revertCodexThread(request, 'thread-1', 'turn-2')).resolves.toEqual({ threadId: 'forked' })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/fork', { threadId: 'thread-1', beforeTurnId: 'turn-2' })
  })
})
