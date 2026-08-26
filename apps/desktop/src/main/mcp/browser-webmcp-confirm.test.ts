import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  awaitWebmcpCallConfirm,
  resolveWebmcpCallConfirm,
} from './browser-webmcp-confirm'

function resolvedEvent(requestId: string, approved: boolean): AgentEvent {
  return {
    type: 'interaction_resolved',
    interactionType: 'permission',
    requestId,
    approved,
  }
}

describe('browser-webmcp-confirm', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits the qualified permission request and resolves accept with alwaysAllow', async () => {
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      requestId = event.request.requestId
      expect(event.request).toMatchObject({
        toolName: 'mcp__superone__browser_tools_call',
        toolUseId: requestId,
        allowAlwaysAllow: true,
        serverName: 'superone',
        input: {
          name: 'add-todo',
          input: { text: 'ship it' },
          origin: 'https://example.com',
        },
        message: 'Allow the page at https://example.com to run its tool "add-todo"?',
      })
      queueMicrotask(() => {
        expect(resolveWebmcpCallConfirm(requestId, 'accept', true)).toBe(true)
      })
    })

    await expect(awaitWebmcpCallConfirm({
      emitHostEvent: emit,
      origin: 'https://example.com',
      toolName: 'add-todo',
      toolInput: { text: 'ship it' },
    })).resolves.toEqual({ action: 'accept', alwaysAllow: true })
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, true))
  })

  it.each([
    ['decline', 'no thanks'],
    ['cancel', 'not now'],
  ] as const)('resolves %s and dismisses the interaction', async (action, reason) => {
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      requestId = event.request.requestId
      queueMicrotask(() => {
        resolveWebmcpCallConfirm(requestId, action, false, reason)
      })
    })

    await expect(awaitWebmcpCallConfirm({
      emitHostEvent: emit,
      origin: 'https://example.com',
      toolName: 'add-todo',
      toolInput: {},
    })).resolves.toEqual({ action, reason })
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, false))
  })

  it('times out and dismisses the interaction', async () => {
    vi.useFakeTimers()
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type === 'permission_request') requestId = event.request.requestId
    })

    const pending = awaitWebmcpCallConfirm({
      emitHostEvent: emit,
      origin: 'https://example.com',
      toolName: 'add-todo',
      toolInput: {},
    })
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(120_001)
    await rejection
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, false))
  })
})
