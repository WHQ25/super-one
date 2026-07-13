import { describe, it, expect } from 'vitest'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { mapPermissionDecision, mapPermissionRequest } from './acp-permission-map'

describe('mapPermissionRequest', () => {
  it('maps tool call + options into PermissionRequest', () => {
    const params: RequestPermissionRequest = {
      sessionId: 's1',
      toolCall: {
        toolCallId: 'tc1',
        title: 'Edit file',
        kind: 'edit',
        rawInput: { path: '/a.ts' },
        locations: [{ path: '/a.ts' }],
      },
      options: [
        { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
        { optionId: 'a2', name: 'Always', kind: 'allow_always' },
        { optionId: 'r1', name: 'Deny', kind: 'reject_once' },
      ],
    }
    const { request, options } = mapPermissionRequest(params)
    expect(request.requestId).toBe('tc1')
    expect(request.toolName).toBe('Edit file')
    expect(request.allowAlwaysAllow).toBe(true)
    expect(request.blockedPath).toBe('/a.ts')
    expect(request.input).toEqual({ path: '/a.ts' })
    expect(options).toHaveLength(3)
  })
})

describe('mapPermissionDecision', () => {
  const options = [
    { optionId: 'a1', kind: 'allow_once' as const },
    { optionId: 'a2', kind: 'allow_always' as const },
    { optionId: 'r1', kind: 'reject_once' as const },
  ]

  it('selects allow_once', () => {
    expect(mapPermissionDecision(options, true)).toEqual({
      outcome: { outcome: 'selected', optionId: 'a1' },
    })
  })

  it('selects allow_always when requested', () => {
    expect(mapPermissionDecision(options, true, true)).toEqual({
      outcome: { outcome: 'selected', optionId: 'a2' },
    })
  })

  it('selects reject_once on deny', () => {
    expect(mapPermissionDecision(options, false)).toEqual({
      outcome: { outcome: 'selected', optionId: 'r1' },
    })
  })

  it('cancels when decision is cancel', () => {
    expect(mapPermissionDecision(options, true, false, 'cancel')).toEqual({
      outcome: { outcome: 'cancelled' },
    })
  })
})
