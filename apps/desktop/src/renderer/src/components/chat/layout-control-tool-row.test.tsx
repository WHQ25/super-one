/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { LayoutControlToolRow } from '@superone/chat-view/presenters/LayoutControlToolRow'
import { applyContentDelta } from '@superone/shared/content-delta'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { isAlwaysHiddenToolName } from '@superone/shared/tool-ui'
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
    expect(screen.getByText('unavailable')).toBeTruthy()
  })

  it('shows the width a resize applied, not the one it asked for', () => {
    const params = projected({ action: 'resize_panel', width: 5000 })
    const { rerender } = render(<LayoutControlToolRow mcpToolName="layout_act" params={params} result={null} isStreaming />)
    expect(screen.getByText('5000px')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={params} result={JSON.stringify({ status: 'applied', visible: true, width: 908 })} isStreaming={false} />)
    expect(screen.getByText('Panel Resized')).toBeTruthy()
    expect(screen.getByText('908px')).toBeTruthy()
  })

  it('names the chat mode it switched to', () => {
    render(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'chat_mode', mode: 'icon' })} result={JSON.stringify({ status: 'applied', visible: true })} isStreaming={false} />)
    expect(screen.getByText('Chat View Changed')).toBeTruthy()
    expect(screen.getByText('icon')).toBeTruthy()
  })

  it('names native window modes through the mobile projection', () => {
    const { rerender } = render(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'window_mode', mode: 'mini' })} result={JSON.stringify({ status: 'applied', visible: true })} isStreaming={false} />)
    expect(screen.getByText('Window Mode Changed')).toBeTruthy()
    expect(screen.getByText('Mini Window')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'window_mode', mode: 'full' })} isStreaming />)
    expect(screen.getByText('Full Window')).toBeTruthy()
  })

  it('shows applied window dimensions and explicit fullscreen operations', () => {
    const { rerender } = render(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'resize_window', width: 9999, height: 900 })} result={JSON.stringify({ status: 'applied', visible: true, width: 1440, height: 900 })} isStreaming={false} />)
    expect(screen.getByText('Window Resized')).toBeTruthy()
    expect(screen.getByText('1440 × 900px')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'enter_fullscreen' })} isStreaming />)
    expect(screen.getByText(/Entering fullscreen/)).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'exit_fullscreen' })} result={JSON.stringify({ status: 'applied', visible: true })} isStreaming={false} />)
    expect(screen.getByText('Fullscreen Exited')).toBeTruthy()
  })

  it('names batch sessions, closeAll and divider counts without requiring opaque mobile identities', () => {
    const params = projected({ action: 'split_session', sessionIds: ['voice', { environmentId: 'node', sessionId: 'worker' }] })
    expect(params.sessionIds).toEqual(['', ''])
    const { rerender } = render(<LayoutControlToolRow mcpToolName="layout_act" params={params} isStreaming={false} />)
    expect(screen.getByText('2 sessions')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'close_split', closeAll: true })} isStreaming={false} />)
    expect(screen.getByText('all splits')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'resize_splits', dividers: [{ id: 'opaque', ratio: 0.5 }, { id: 'another', ratio: 0.6 }] })} isStreaming={false} />)
    expect(screen.getByText('Splits Resized')).toBeTruthy()
    expect(screen.getByText('2 dividers')).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'maximize_split' }} isStreaming />)
    expect(screen.getByText(/Maximizing split/)).toBeTruthy()
    rerender(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'restore_splits' }} isStreaming={false} isDenied />)
    expect(screen.getByText('Restore Splits')).toBeTruthy()
  })

  it('names where the floating chat moved', () => {
    render(<LayoutControlToolRow mcpToolName="layout_act" params={projected({ action: 'chat_mode', mode: 'floating', position: 'top-right' })} result={JSON.stringify({ status: 'applied', visible: true })} isStreaming={false} />)
    expect(screen.getByText('floating · top right')).toBeTruthy()
  })

  it('uses the action label and no outcome on an error', () => {
    render(<LayoutControlToolRow mcpToolName="layout_act" params={{ action: 'close_tab', tab: 'file:src/main.ts' }} result="Tab file:src/main.ts was not opened by you" isError isStreaming={false} />)
    expect(screen.getByText('Close Tab')).toBeTruthy()
    expect(screen.getByText('main.ts')).toBeTruthy()
  })

  // The row stays implemented for when it is shown again; for now both tools are hidden like session_rename.
  it('is hidden on the desktop and in the portable turn the phone draws', () => {
    expect(isAlwaysHiddenToolName('mcp__superone__layout_act')).toBe(true)
    expect(isAlwaysHiddenToolName('mcp__superone__layout_snapshot')).toBe(true)

    const full = 'mcp__superone__layout_act'
    const content = applyContentDelta(
      [{ type: 'tool_use', toolName: full, toolUseId: 'u1', status: 'streaming', input: sanitizeRemoteToolInput(full, JSON.stringify({ action: 'open_file', path: 'src/main.ts', line: 42 })) } as ContentBlock],
      { type: 'tool_result', toolUseId: 'u1', summary: JSON.stringify({ status: 'applied', visible: true, tab: 'file:src/main.ts' }) } as ContentBlock,
    )
    const message = { id: 't1', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude', content } as ChatMessage
    const { container } = render(<PortableMessage message={message} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={false} />)
    expect(container.textContent).not.toContain('File Opened')
  })
})
