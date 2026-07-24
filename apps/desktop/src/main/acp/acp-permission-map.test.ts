import { describe, it, expect } from 'vitest'
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { mapPermissionDecision, mapPermissionRequest } from './acp-permission-map'

describe('mapPermissionRequest', () => {
  it('maps tool call + options into PermissionRequest with Claude-shaped names', () => {
    const params: RequestPermissionRequest = {
      sessionId: 's1',
      toolCall: {
        toolCallId: 'tc1',
        title: 'Edit file',
        kind: 'edit',
        rawInput: { path: '/a.ts', oldText: 'x', newText: 'y' },
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
    expect(request.toolName).toBe('Edit')
    expect(request.allowAlwaysAllow).toBe(true)
    expect(request.blockedPath).toBe('/a.ts')
    expect(request.decisionReason).toBe('Edit file')
    expect(request.input).toEqual({
      file_path: '/a.ts',
      old_string: 'x',
      new_string: 'y',
    })
    expect(options).toHaveLength(3)
  })

  it('maps execute permission to Bash with command', () => {
    const params: RequestPermissionRequest = {
      sessionId: 's1',
      toolCall: {
        toolCallId: 'tc2',
        kind: 'execute',
        title: 'Run tests',
        rawInput: { command: 'bun test' },
      },
      options: [
        { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
        { optionId: 'r1', name: 'Deny', kind: 'reject_once' },
      ],
    }
    const { request } = mapPermissionRequest(params)
    expect(request.toolName).toBe('Bash')
    expect(request.input).toEqual({ command: 'bun test' })
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

  it('prefers allow-always-mcp option id for MCP session grants', () => {
    const mcpOptions = [
      { optionId: 'allow-always-mcp', kind: 'allow_always' as const },
      { optionId: 'allow-once', kind: 'allow_once' as const },
      { optionId: 'reject-once', kind: 'reject_once' as const },
    ]
    expect(mapPermissionDecision(mcpOptions, true, true)).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-always-mcp' },
    })
    // One-shot path still picks allow_once
    expect(mapPermissionDecision(mcpOptions, true, false)).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
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
