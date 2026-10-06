/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage, CodexMcpToolCallItem, CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'

/**
 * A `widget_code` call can come back with only the short acknowledgement the model read.
 * The phone keeps the call's whole input (`shouldKeepRemoteToolInput`), so it draws the
 * widget from that, through every adapter a call reaches the phone by.
 */
const WIDGET = 'mcp__superone__widget_show'
const ARGS = { title: 'releases', widget_code: '<div id="chart">Release chart</div>', data: { builds: 3 } }
const INPUT = JSON.stringify(ARGS)
const ACK = 'Rendered widget "releases".'

function widgetDocument(container: HTMLElement): string | null {
  return container.querySelector('iframe')?.getAttribute('srcdoc') ?? null
}

function turn(fields: Pick<ChatMessage, 'providerId' | 'content'> & { metadata?: ChatMessage['metadata'] }): ChatMessage {
  return { id: 'turn-1', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', ...fields } as ChatMessage
}

function claudeWidgetTurn(result?: Partial<Extract<ContentBlock, { type: 'tool_result' }>>, input = INPUT): ChatMessage {
  return turn({
    providerId: 'claude',
    content: [
      { type: 'tool_use', toolName: WIDGET, toolUseId: 'w', input, status: 'complete' },
      ...(result ? [{ type: 'tool_result', toolUseId: 'w', summary: ACK, ...result } as ContentBlock] : []),
    ],
  })
}

function codexWidget(overrides: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem {
  return {
    type: 'mcp_tool_call',
    id: 'codex-widget',
    server: 'superone',
    tool: 'widget_show',
    arguments: ARGS,
    status: 'completed',
    result: { content: [{ type: 'text', text: ACK }], structuredContent: null },
    ...overrides,
  }
}

function codexTurn(items: CodexThreadItem[]): ChatMessage {
  return turn({ providerId: 'codex', content: [], metadata: { codex: { threadId: 'thread', usage: null, items } } } as never)
}

function renderTurn(message: ChatMessage) {
  return render(<PortableMessage message={message} scheme="dark" pendingPermission={null} />)
}

describe('a phone widget drawn from its call input', () => {
  it('draws a Claude call whose result is only the acknowledgement, with its data', () => {
    const { container } = renderTurn(claudeWidgetTurn({}))
    expect(widgetDocument(container)).toContain('Release chart')
    expect(widgetDocument(container)).toContain('{data:{"builds":3}}')
  })

  it('keeps the widget of a call interrupted after its input was complete', () => {
    expect(widgetDocument(renderTurn(claudeWidgetTurn()).container)).toContain('Release chart')
  })

  it('keeps the ordinary row, with the widget glyph, for a call interrupted while its input streamed', () => {
    const { container } = renderTurn(claudeWidgetTurn(undefined, '{"title":"releases","widget_code":"<div>Rel'))
    expect(widgetDocument(container)).toBeNull()
    expect(container.textContent).toContain('widget show')
    expect(container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
  })

  it('keeps the ordinary row for a denial, read from its text whatever the error flag says', () => {
    const { container } = renderTurn(claudeWidgetTurn({ summary: '[denied] Not now' }))
    expect(widgetDocument(container)).toBeNull()
    expect(container.querySelector('.denied')).not.toBeNull()
  })

  it.each([
    ['object', ARGS],
    ['string', INPUT],
  ])('draws a Codex item whose arguments are a serialized %s', (_, args) => {
    const { container } = renderTurn(codexTurn([codexWidget({ arguments: args })]))
    expect(widgetDocument(container)).toContain('Release chart')
  })

  it('shows a Codex tool error reply as an error row, not a widget', () => {
    const { container } = renderTurn(codexTurn([codexWidget({
      result: { content: [{ type: 'text', text: 'widget_show failed.' }], structuredContent: null, isError: true },
    })]))
    expect(widgetDocument(container)).toBeNull()
    expect(container.querySelector('.errored')).not.toBeNull()
  })
})
