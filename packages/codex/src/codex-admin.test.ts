import { describe, expect, it, vi } from 'vitest'
import type { CodexAppServerHandle } from './app-server-client'
import { loginMcpServerOauth } from './codex-admin'

describe('loginMcpServerOauth', () => {
  it('forwards 149 login options and ignores another thread completion', async () => {
    const request = vi.fn(async () => ({ authorizationUrl: 'https://auth.example.com' }))
    const notifications = [
      { method: 'mcpServer/oauthLogin/completed', params: { name: 'linear', threadId: 'other', success: true } },
      { method: 'mcpServer/oauthLogin/completed', params: { name: 'linear', threadId: 'thread-1', success: true } },
    ]
    const client = {
      request,
      nextNotification: vi.fn(async () => notifications.shift() ?? null),
    } as unknown as CodexAppServerHandle

    await expect(loginMcpServerOauth(client, 'linear', undefined, 1_000, {
      clientRegistration: 'dcr',
      threadId: 'thread-1',
      scopes: ['read', 'write'],
      timeoutSecs: 60,
    })).resolves.toMatchObject({ success: true, authorizationUrl: 'https://auth.example.com' })

    expect(request).toHaveBeenCalledWith('mcpServer/oauth/login', {
      name: 'linear',
      clientRegistration: 'dcr',
      threadId: 'thread-1',
      scopes: ['read', 'write'],
      timeoutSecs: 60,
    })
  })
})
