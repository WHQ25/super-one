import { describe, expect, it, vi } from 'vitest'
import { parseAccountUsage } from './codex-admin'
import { readCodexConfigRequirements, readCodexErrorOverrides, readCodexMcpResource, readCodexServerDiagnostics } from './protocol-v149'

describe('Codex 149 protocol helpers', () => {
  it('parses per-thread usage and credit breakdowns', () => {
    expect(parseAccountUsage({
      summary: { lifetimeTokens: 1200 },
      threadUsage: {
        threadId: 'thread-1',
        estimatedUsageCreditsMicros: 125000,
        estimatedUsageUsdMicros: 34000,
        groups: [{ model: 'gpt-5.4', reasoningEffort: 'high', totalTokens: 42, estimatedUsageCreditsMicros: 125000 }],
      },
    })).toMatchObject({
      lifetimeTokens: 1200,
      threadUsage: {
        threadId: 'thread-1',
        estimatedUsageCreditsMicros: 125000,
        groups: [{ model: 'gpt-5.4', reasoningEffort: 'high', totalTokens: 42 }],
      },
    })
  })

  it('keeps normalized structured errors stable across process boundaries', () => {
    expect(readCodexErrorOverrides({ codexErrorInfo: { code: 'misalignmentPolicyViolation', httpStatus: 403 } })).toEqual({
      code: 'misalignmentPolicyViolation', httpStatus: 403,
    })
  })

  it('preserves managed requirements for product-level policy awareness', async () => {
    const request = vi.fn(async () => ({
      requirements: { allowedSandboxModes: ['workspace-write'], allowRemoteControl: false, futurePolicy: { enabled: true } },
    }))
    await expect(readCodexConfigRequirements({ request })).resolves.toEqual({
      allowedSandboxModes: ['workspace-write'], allowRemoteControl: false, futurePolicy: { enabled: true },
    })
    expect(request).toHaveBeenCalledWith('configRequirements/read', {})
  })

  it('maps server diagnostics without leaking unknown fields', async () => {
    const request = vi.fn(async () => ({
      process: { id: 7, residentMemoryBytes: 1024, physicalFootprintBytes: null },
      gauges: [{ name: 'threads', value: 2 }, { name: '', value: 9 }],
    }))
    await expect(readCodexServerDiagnostics({ request })).resolves.toEqual({
      process: { id: 7, residentMemoryBytes: 1024, physicalFootprintBytes: null },
      gauges: [{ name: 'threads', value: 2 }],
    })
    expect(request).toHaveBeenCalledWith('server/diagnostics')
  })

  it('forwards MCP resource origin and connector identity', async () => {
    const request = vi.fn(async () => ({ contents: [{ text: 'ok' }], originCallId: 'call-1' }))
    await expect(readCodexMcpResource({ request }, {
      server: 'docs', uri: 'file://guide', threadId: 'thread-1', originCallId: 'call-1', connectorId: 'connector-1',
    })).resolves.toMatchObject({ originCallId: 'call-1', contents: [{ text: 'ok' }] })
    expect(request).toHaveBeenCalledWith('mcpServer/resource/read', {
      server: 'docs', uri: 'file://guide', threadId: 'thread-1', originCallId: 'call-1', connectorId: 'connector-1',
    })
  })
})
