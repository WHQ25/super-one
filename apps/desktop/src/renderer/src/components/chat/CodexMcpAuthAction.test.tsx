/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { CodexMcpAuthAction, hasCodexMcpAuthChallenge } from './CodexMcpAuthAction'

vi.mock('@/stores/chat', () => {
  const state = { activeProject: '/project', apiProviderId: null as string | null }
  return {
    useChatStore: (selector: (s: typeof state) => unknown) => selector(state),
    useActiveSession: (selector: (s: typeof state) => unknown) => selector(state),
  }
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const item = (over: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem => ({
  id: 'mcp-1',
  type: 'mcp_tool_call',
  server: 'linear',
  tool: 'list_issues',
  arguments: {},
  status: 'failed',
  ...over,
})

describe('CodexMcpAuthAction', () => {
  beforeEach(() => {
    const w = window as unknown as { app: { codexMcpServerOauthLogin: ReturnType<typeof vi.fn> } }
    w.app = { codexMcpServerOauthLogin: vi.fn().mockResolvedValue({ success: true }) }
  })

  it('does not treat a user-deny error as an OAuth challenge', () => {
    expect(hasCodexMcpAuthChallenge(item({
      error: { message: 'User denied the request' },
    }))).toBe(false)
    expect(hasCodexMcpAuthChallenge(item({
      authRequired: true,
      error: { message: 'MCP authentication required' },
      result: { content: [], structuredContent: null, meta: { 'mcp/www_authenticate': { authorizationUrl: 'https://auth' } } },
    }))).toBe(true)
  })

  it('starts Codex MCP OAuth login without replaying the tool', async () => {
    render(<CodexMcpAuthAction item={item({
      authRequired: true,
      result: { content: [], structuredContent: null, meta: { 'mcp/www_authenticate': {} } },
    })} />)

    fireEvent.click(screen.getByRole('button', { name: /Sign in to linear/i }))
    await waitFor(() => {
      expect(window.app.codexMcpServerOauthLogin).toHaveBeenCalledWith('/project', 'linear', null)
    })
    expect(window.app.codexMcpServerOauthLogin).toHaveBeenCalledTimes(1)
  })
})
