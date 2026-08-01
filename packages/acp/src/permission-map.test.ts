import { describe, expect, it } from 'vitest'
import { mapPermissionDecision, mapPermissionRequest } from './permission-map'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

describe('mapPermissionRequest', () => {
  it('maps tool call to PermissionRequest', () => {
    const params = {
      options: [
        { optionId: 'allow', kind: 'allow_once' },
        { optionId: 'deny', kind: 'reject_once' },
      ],
      toolCall: {
        toolCallId: 't1',
        title: 'Write',
        rawInput: { path: 'a.ts' },
        locations: [{ path: '/tmp/a.ts' }],
      },
    } as unknown as RequestPermissionRequest
    const { request, options } = mapPermissionRequest(params)
    expect(request.requestId).toBe('t1')
    expect(request.toolName).toBe('Write')
    expect(request.input).toEqual({ path: 'a.ts' })
    expect(options).toHaveLength(2)
  })
})

describe('mapPermissionDecision', () => {
  it('selects allow_once', () => {
    const res = mapPermissionDecision(
      [
        { optionId: 'a', kind: 'allow_once' },
        { optionId: 'r', kind: 'reject_once' },
      ],
      true,
    )
    expect(res).toEqual({ outcome: { outcome: 'selected', optionId: 'a' } })
  })

  it('cancels', () => {
    expect(mapPermissionDecision([], false, false, 'cancel')).toEqual({
      outcome: { outcome: 'cancelled' },
    })
  })
})
