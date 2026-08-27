import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, WebmcpTrustConfirmPayload } from '@superone/shared/agent-types'
import {
  awaitWebmcpTrustConfirm,
  resolveWebmcpTrustConfirm,
} from './browser-webmcp-confirm'

function resolvedEvent(requestId: string, approved: boolean): AgentEvent {
  return {
    type: 'interaction_resolved',
    interactionType: 'permission',
    requestId,
    approved,
  }
}

function confirmPayload(overrides: Partial<WebmcpTrustConfirmPayload> = {}): WebmcpTrustConfirmPayload {
  return {
    origin: 'https://shop.example.com',
    reason: 'first_use',
    changedTools: [],
    tools: [
      { name: 'search', description: 'Search products.', annotations: { readOnlyHint: true } },
      { name: 'add_to_cart', description: 'Add to cart.', annotations: { readOnlyHint: false } },
    ],
    ...overrides,
  }
}

describe('browser-webmcp-confirm', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits a site-trust request naming the origin and its tool count', async () => {
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      requestId = event.request.requestId
      expect(event.request).toMatchObject({
        toolUseId: requestId,
        requestKind: 'webmcp_trust_confirm',
        allowAlwaysAllow: true,
        serverName: 'superone',
        input: { origin: 'https://shop.example.com', tools: ['search', 'add_to_cart'] },
        message: 'Allow https://shop.example.com to offer its 2 page tools to the agent?',
      })
      expect(event.request.webmcpTrustConfirm?.tools).toHaveLength(2)
      queueMicrotask(() => {
        expect(resolveWebmcpTrustConfirm(requestId, 'accept', true)).toBe(true)
      })
    })

    await expect(awaitWebmcpTrustConfirm({
      emitHostEvent: emit,
      confirm: confirmPayload(),
    })).resolves.toEqual({ action: 'accept', scope: 'always' })
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, true))
  })

  it('reads the trust scope out of formAnswers', async () => {
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      queueMicrotask(() => {
        resolveWebmcpTrustConfirm(event.request.requestId, 'accept', false, undefined, { scope: 'session' })
      })
    })

    await expect(awaitWebmcpTrustConfirm({
      emitHostEvent: emit,
      confirm: confirmPayload(),
    })).resolves.toEqual({ action: 'accept', scope: 'session' })
  })

  it('names the changed tools when a trusted site re-registers one', async () => {
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      expect(event.request.message).toBe(
        'The page at https://shop.example.com changed the tools you trusted (search). Trust it again?',
      )
      queueMicrotask(() => {
        resolveWebmcpTrustConfirm(event.request.requestId, 'decline', false, 'nope')
      })
    })

    await expect(awaitWebmcpTrustConfirm({
      emitHostEvent: emit,
      confirm: confirmPayload({ reason: 'tool_changed', changedTools: ['search'] }),
    })).resolves.toEqual({ action: 'decline', reason: 'nope' })
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
        resolveWebmcpTrustConfirm(requestId, action, false, reason)
      })
    })

    await expect(awaitWebmcpTrustConfirm({
      emitHostEvent: emit,
      confirm: confirmPayload(),
    })).resolves.toEqual({ action, reason })
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, false))
  })

  it('times out and dismisses the interaction', async () => {
    vi.useFakeTimers()
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type === 'permission_request') requestId = event.request.requestId
    })

    const pending = awaitWebmcpTrustConfirm({
      emitHostEvent: emit,
      confirm: confirmPayload(),
    })
    const rejection = expect(pending).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(120_001)
    await rejection
    expect(emit).toHaveBeenLastCalledWith(resolvedEvent(requestId, false))
  })
})
