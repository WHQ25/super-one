import { describe, expect, it } from 'vitest'
import type { McpAppDeviceRequest } from '@superone/shared/agent-types'
import { parseSessionKey } from '@superone/shared/environment/refs'
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import { deviceMcpAppHostRequest } from './mobile-request'

const CALL: McpAppDeviceRequest = { messageId: 'm', appInstanceId: 'view-1', operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }

describe('deviceMcpAppHostRequest', () => {
  it('keys a local session to the local environment and a remote one to its connection', () => {
    expect(parseSessionKey(deviceMcpAppHostRequest('/Users/me/proj', 'sess-1', CALL).sessionKey))
      .toEqual({ environmentId: 'local', sessionId: 'sess-1' })
    expect(parseSessionKey(deviceMcpAppHostRequest(remoteProjectKey('conn-1', '/home/node/proj'), 'sess-2', CALL).sessionKey))
      .toEqual({ environmentId: 'conn-1', sessionId: 'sess-2' })
  })

  it('keeps the View operation and never lets the device choose the session', () => {
    const forged = { ...CALL, sessionKey: 'local:someone-else' } as McpAppDeviceRequest
    const request = deviceMcpAppHostRequest('/Users/me/proj', 'sess-1', forged)
    expect(request).toMatchObject({ operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 }, appInstanceId: 'view-1', messageId: 'm' })
    expect(request.sessionKey).toBe('local:sess-1')
  })

  it('refuses a link, which the phone opens itself', () => {
    const link = { messageId: 'm', appInstanceId: 'view-1', operation: 'openLink', url: 'https://example.com' } as unknown as McpAppDeviceRequest
    expect(() => deviceMcpAppHostRequest('/Users/me/proj', 'sess-1', link)).toThrow('invalid mcp_app_request operation')
  })
})
