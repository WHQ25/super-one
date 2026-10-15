/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'

const toolName = 'mcp__superone__session_collab_request'
const input = JSON.stringify({ launches: [{ name: 'Wren', role: 'Implementer' }] })

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('collaboration request outcomes', () => {
  it.each(['rejected', 'cancelled'])('keeps the request action and peer when %s on desktop', (status) => {
    const { container } = render(
      <ToolBlock toolName={toolName} input={input} status="complete" result={JSON.stringify({ status })} />,
    )

    expect(screen.getByText('Request Collaboration')).toBeInTheDocument()
    expect(screen.getByText('Wren - Implementer')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(container.querySelector('.denied')).not.toBeNull()
    expect(container.querySelector('.animate-shimmer')).toBeNull()
    expect(container.textContent).not.toContain('Settings Change')
  })

  it.each(['rejected', 'cancelled'])('uses the same denied request title when %s on the phone', (status) => {
    const message: ChatMessage = {
      id: 'request-1',
      role: 'assistant',
      status: 'complete',
      createdAt: '2026-10-15T00:00:00.000Z',
      providerId: 'claude',
      content: [
        { type: 'tool_use', toolUseId: 'request-tool', toolName, input, status: 'complete' },
        { type: 'tool_result', toolUseId: 'request-tool', summary: JSON.stringify({ status }) },
      ],
    }
    render(<PortableMessage message={message} scheme="dark" pendingPermission={null} />)

    expect(screen.getByText('Request Collaboration')).toBeInTheDocument()
    expect(screen.getByText('Denied')).toBeInTheDocument()
  })

  it.each([
    { result: '[denied] User declined', isError: false, badge: 'Denied' },
    { result: 'Request failed', isError: true, badge: 'Error' },
  ])('keeps the request action for a $badge result without structured status', ({ result, isError, badge }) => {
    render(<ToolBlock toolName={toolName} input={input} status="complete" result={result} isError={isError} />)

    expect(screen.getByText('Request Collaboration')).toBeInTheDocument()
    expect(screen.getByText(badge)).toBeInTheDocument()
    expect(screen.queryByText('Collaboration Requested')).not.toBeInTheDocument()
  })

  it('preserves running and approved labels', () => {
    const { rerender } = render(<ToolBlock toolName={toolName} input={input} status="streaming" />)
    expect(screen.getByText('Requesting collaboration…')).toBeInTheDocument()

    rerender(<ToolBlock toolName={toolName} input={input} status="complete" result={JSON.stringify({ status: 'approved' })} />)
    expect(screen.getByText('Collaboration Requested')).toBeInTheDocument()
    expect(screen.queryByText('Denied')).not.toBeInTheDocument()
  })

  it('translates the denied action for legacy collaboration requests', async () => {
    await i18n.changeLanguage('zh')
    render(
      <ToolBlock toolName="mcp__superone__session_request_agents_collab" input={input} status="complete" result={JSON.stringify({ status: 'rejected' })} />,
    )

    expect(screen.getByText('请求协作')).toBeInTheDocument()
    expect(screen.getByText('Wren - Implementer')).toBeInTheDocument()
    expect(screen.queryByText('设置更改已拒绝')).not.toBeInTheDocument()
  })
})
