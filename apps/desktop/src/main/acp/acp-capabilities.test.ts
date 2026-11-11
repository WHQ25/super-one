import { describe, expect, it } from 'vitest'
import { readAgentCapabilities } from './acp-config'

describe('readAgentCapabilities', () => {
  it('defaults mcp transports to false when mcpCapabilities is omitted on generic agents', () => {
    expect(
      readAgentCapabilities({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'Generic ACP Agent', version: '1.0.0' },
      }),
    ).toEqual({
      loadSession: true,
      mcp: { http: false, sse: false, acp: false },
      sessionCapabilities: { additionalDirectories: false },
    })
  })

  it('enables mcp.http when initialize identifies Antigravity via _meta.antigravity', () => {
    expect(
      readAgentCapabilities({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          _meta: {
            antigravity: {
              supportsSessionResume: true,
            },
          },
        } as never,
      }),
    ).toEqual({
      loadSession: true,
      mcp: { http: true, sse: false, acp: false },
      sessionCapabilities: { additionalDirectories: false },
    })
  })

  it('enables mcp.http when initialize identifies Antigravity via agentInfo.name', () => {
    expect(
      readAgentCapabilities({
        protocolVersion: 1,
        agentCapabilities: {},
        agentInfo: { name: 'Antigravity ACP Server', version: '1.5.3' },
      }),
    ).toEqual({
      loadSession: false,
      mcp: { http: true, sse: false, acp: false },
      sessionCapabilities: { additionalDirectories: false },
    })
  })
})
