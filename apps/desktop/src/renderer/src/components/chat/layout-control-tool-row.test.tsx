/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { LayoutControlToolRow } from '@superone/chat-view/presenters/LayoutControlToolRow'
import { applyContentDelta } from '@superone/shared/content-delta'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

function projected(params: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(sanitizeRemoteToolInput('mcp__superone__layout_act', JSON.stringify(params)) || '{}')
}

describe('layout control rows', () => {
  it('names the action and its subject from what the phone receives', () => {
    const params = projected({ action: 'open_file', path: '/work/app/src/main.ts', line: 42, sessionId: 'opaque' })
    expect(params).toEqual({ action: 'open_file', path: '/work/app/src/main.ts', line: 42 })
    render(<LayoutControlToolRow mcpToolName="layout_act" params={params} result={JSON.stringify({ status: 'applied', visible: true })} isStreaming={false} />)
    expect(screen.getByText('File Opened')).toBeTruthy()
    expect(screen.getByText('main.ts:42')).toBeTruthy()
  })

  it('says when a change waits for the session, was skipped, or cannot run on a remote node', () => {
    const { rerender } = render(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'show_panel' }} result={JSON.stringify({ status: 'queued', visible: false })} isStreaming={false} />)
    expect(screen.getByText('when you open this session')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'hide_sidebar' }} result={JSON.stringify({ status: 'skipped', visible: false, reason: 'not_visible' })} isStreaming={false} />)
    expect(screen.getByText('Sidebar Collapsed')).toBeTruthy()
    expect(screen.getByText('skipped while you were elsewhere')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'show_panel' }} result={JSON.stringify({ status: 'unsupported', reason: 'remote_node' })} isStreaming={false} />)
    expect(screen.getByText('not available on a remote node')).toBeTruthy()
  })

  it('uses the action label and no outcome on an error', () => {
    render(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'close_tab', tab: 'file:src/main.ts' }} result="Tab file:src/main.ts was not opened by you" isError isStreaming={false} />)
    expect(screen.getByText('Close Tab')).toBeTruthy()
    expect(screen.getByText('main.ts')).toBeTruthy()
  })

  it('reaches the phone through the portable turn', () => {
    const full = 'mcp__superone__layout_act'
    const content = applyContentDelta(
      [{ type: 'tool_use', toolName: full, toolUseId: 'u1', status: 'streaming', input: sanitizeRemoteToolInput(full, JSON.stringify({ action: 'open_file', path: 'src/main.ts', line: 42 })) } as ContentBlock],
      { type: 'tool_result', toolUseId: 'u1', summary: JSON.stringify({ status: 'applied', visible: true, tab: 'file:src/main.ts' }) } as ContentBlock,
    )
    const message = { id: 't1', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude', content } as ChatMessage
    const { container } = render(<PortableMessage message={message} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={false} />)
    expect(container.textContent).toContain('File Opened')
    expect(container.textContent).toContain('main.ts:42')
  })
})
