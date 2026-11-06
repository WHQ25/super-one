/** @vitest-environment jsdom */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import { DetailViews } from '@superone/runtime/stream/delivery/projection'
import { createDetailClient, type DetailTransport } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { SessionScopeProvider } from '@/stores/chat-store/session-scope'
import { ToolBlock } from './ToolBlock'

const taskId = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const params = { title: 'Fix the flaky login test', tldr: 'Times out on CI.', prompt: 'Restore the mock clock after each login test.\nVerify repeated runs pass.' }

describe('remote suggested-task prompt', () => {
  it.each([
    { surface: 'desktop', launched: false }, { surface: 'desktop', launched: true },
    { surface: 'phone', launched: false }, { surface: 'phone', launched: true },
  ])('opens the full prompt on $surface (launched: $launched)', async ({ surface, launched }) => {
    Object.defineProperty(window, 'environment', { configurable: true, value: {
      sessionSource: async () => 'remote-node',
      sessionLinkMetadata: async (refs: SessionRef[]) => refs.map(ref => ({ status: 'unavailable', ref })),
      callSession: async () => ({ profiles: [], initial: { agentId: 'claude-base', settings: {} } }),
    } })
    const source: ChatMessage = {
      id: 'turn', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content: [
        { type: 'tool_use', toolName: 'mcp__superone__session_suggest_task', toolUseId: 'suggest', input: JSON.stringify(params), status: 'complete', ...(launched ? { suggestedTask: { status: 'launched' as const, sessionId: 'follow-up' } } : {}) },
        { type: 'tool_result', toolUseId: 'suggest', summary: JSON.stringify({ taskId }) },
      ],
    }
    const projected = projectWindowMessage(source)
    expect(JSON.stringify(projected)).not.toContain('Restore the mock clock')
    const views = new DetailViews()
    views.open('source')
    const subscribe = vi.fn<DetailTransport['subscribe']>(async (target, subscriptionId) => views.subscribe('source', subscriptionId, target.detailRef, source))
    const client = createDetailClient({ subscribe, unsubscribe: () => {} }, { newId: () => crypto.randomUUID() })
    const tool = projected.content.find(block => block.type === 'tool_use')
    if (!tool) throw new Error('Missing tool row')
    const view = render(<DetailScopeProvider scope={{ client, environmentId: 'remote-node', sessionId: 'source' }}>
      <SessionScopeProvider value={{ projectPath: 'remote:remote-node:/repo', sessionId: 'source' }}>
        {surface === 'desktop'
          ? <ToolBlock {...tool} result={JSON.stringify({ taskId })} />
          : <PortableMessage message={projected} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={false} />}
      </SessionScopeProvider>
    </DetailScopeProvider>)
    const toggle = await view.findByTitle('Show Full Prompt')
    expect(subscribe.mock.calls[0][0]).toMatchObject({ environmentId: 'remote-node', sessionId: 'source' })
    expect(view.queryByText(/Restore the mock clock/)).toBeNull()
    fireEvent.click(toggle)
    expect(view.getByText(/Restore the mock clock/)).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(view.queryByText(/Restore the mock clock/)).toBeNull()
  })
})
