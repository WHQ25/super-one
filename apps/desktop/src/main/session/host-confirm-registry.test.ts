import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, PermissionRequest } from '@superone/shared/agent-types'
import { HostConfirmRegistry, type HostConfirmOpenOptions } from './host-confirm-registry'

type Outcome = { action: 'accept' | 'decline' }

const TIMEOUT_MS = 120_000

function makeRegistry(timeoutMs = TIMEOUT_MS) {
  return new HostConfirmRegistry<Outcome>({
    idPrefix: 'testconfirm',
    timeoutMs,
    timeoutError: (requestId) => new Error(`timed out: ${requestId}`),
  })
}

function openPrompt(registry: HostConfirmRegistry<Outcome>, options?: HostConfirmOpenOptions) {
  const emitted: AgentEvent[] = []
  const emitter = { emitHostEvent: (event: AgentEvent) => void emitted.push(event) }
  const promise = registry.open(
    emitter,
    (requestId): PermissionRequest => ({
      requestId,
      toolName: 'demo_tool',
      toolUseId: requestId,
      input: {},
      allowAlwaysAllow: false,
      serverName: 'superone',
      message: 'Confirm?',
    }),
    options,
  )
  const opened = emitted[0] as Extract<AgentEvent, { type: 'permission_request' }> | undefined
  return { emitted, promise, requestId: opened?.request.requestId ?? '' }
}

function resolvedEvents(emitted: AgentEvent[]): AgentEvent[] {
  return emitted.filter((event) => event.type === 'interaction_resolved')
}

describe('host confirm prompt lifecycle', () => {
  it('dismisses the prompt in the UI when nobody answers before the timeout', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry()
      const { emitted, promise, requestId } = openPrompt(registry)
      const settled = promise.catch((error: Error) => error)

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)

      expect(resolvedEvents(emitted)).toEqual([
        { type: 'interaction_resolved', interactionType: 'permission', requestId, approved: false },
      ])
      expect((await settled).message).toBe(`timed out: ${requestId}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dismisses the prompt and reports approval when the user answers', async () => {
    const registry = makeRegistry()
    const { emitted, promise, requestId } = openPrompt(registry)

    expect(registry.settle(requestId, true, { action: 'accept' })).toBe(true)

    await expect(promise).resolves.toEqual({ action: 'accept' })
    expect(resolvedEvents(emitted)).toEqual([
      { type: 'interaction_resolved', interactionType: 'permission', requestId, approved: true },
    ])
  })

  it('dismisses the prompt when an external caller fails the request', async () => {
    const registry = makeRegistry()
    const { emitted, promise, requestId } = openPrompt(registry)

    expect(registry.fail(requestId, new Error('User cancelled'))).toBe(true)

    await expect(promise).rejects.toThrow('User cancelled')
    expect(resolvedEvents(emitted)).toEqual([
      { type: 'interaction_resolved', interactionType: 'permission', requestId, approved: false },
    ])
  })

  it('ignores a second answer for a prompt that already closed', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry()
      const { emitted, promise, requestId } = openPrompt(registry)
      registry.settle(requestId, true, { action: 'accept' })
      await promise

      expect(registry.settle(requestId, false, { action: 'decline' })).toBe(false)
      expect(registry.fail(requestId, new Error('late'))).toBe(false)
      // A settled prompt must also stop its timer, or the timeout would emit a second
      // interaction_resolved and (for a reused id) dismiss an unrelated prompt.
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)
      expect(resolvedEvents(emitted)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dismisses the prompt when the turn that raised it is aborted', async () => {
    const registry = makeRegistry()
    const controller = new AbortController()
    const { emitted, promise, requestId } = openPrompt(registry, {
      signal: controller.signal,
      abortError: () => new Error('cancelled'),
    })

    controller.abort()

    await expect(promise).rejects.toThrow('cancelled')
    expect(resolvedEvents(emitted)).toEqual([
      { type: 'interaction_resolved', interactionType: 'permission', requestId, approved: false },
    ])
  })

  it('never raises a prompt when the signal is already aborted', async () => {
    const registry = makeRegistry()
    const controller = new AbortController()
    controller.abort()

    const { emitted, promise } = openPrompt(registry, {
      signal: controller.signal,
      abortError: () => new Error('cancelled'),
    })

    await expect(promise).rejects.toThrow('cancelled')
    expect(emitted).toEqual([])
  })

  it('stops listening to the signal once the user has answered', async () => {
    const registry = makeRegistry()
    const controller = new AbortController()
    const { emitted, promise, requestId } = openPrompt(registry, {
      signal: controller.signal,
      abortError: () => new Error('cancelled'),
    })

    registry.settle(requestId, true, { action: 'accept' })
    await promise
    controller.abort()

    expect(resolvedEvents(emitted)).toHaveLength(1)
  })

  it('prefers the per-prompt timeout error when one is supplied', async () => {
    vi.useFakeTimers()
    try {
      const registry = makeRegistry()
      const { promise } = openPrompt(registry, { timeoutError: () => new Error('subject-specific timeout') })
      const settled = promise.catch((error: Error) => error)

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)
      expect((await settled).message).toBe('subject-specific timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
