import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  awaitMiniappCallConfirm,
  resolveMiniappCallConfirm,
} from './miniapp-call-confirm'
import { MINIAPP_CALL_QUALIFIED } from './miniapp-call-policy'

describe('miniapp-call-confirm', () => {
  it('emits host permission_request and resolves accept with alwaysAllow', async () => {
    let requestId = ''
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      requestId = event.request.requestId
      expect(event.request.toolName).toBe(MINIAPP_CALL_QUALIFIED)
      expect(event.request.input).toEqual({
        appId: 'hello',
        tool: 'render',
        input: { x: 1 },
      })
      expect(event.request.allowAlwaysAllow).toBe(true)
      queueMicrotask(() => {
        expect(resolveMiniappCallConfirm(requestId, 'accept', true)).toBe(true)
      })
    })

    const outcome = await awaitMiniappCallConfirm({
      emitHostEvent: emit,
      appId: 'hello',
      tool: 'render',
      toolInput: { x: 1 },
    })
    expect(outcome).toEqual({ action: 'accept', alwaysAllow: true })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('resolves decline', async () => {
    const emit = vi.fn((event: AgentEvent) => {
      if (event.type !== 'permission_request') return
      queueMicrotask(() => {
        resolveMiniappCallConfirm(event.request.requestId, 'decline', false, 'no')
      })
    })
    const outcome = await awaitMiniappCallConfirm({
      emitHostEvent: emit,
      appId: 'a',
      tool: 't',
      toolInput: {},
    })
    expect(outcome).toEqual({ action: 'decline', reason: 'no' })
  })
})
