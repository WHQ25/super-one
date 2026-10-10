/** @vitest-environment jsdom */

import { act, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { installFakeNativeHost } from '@superone/chat-view/fixtures/native-host'
import type { ChatMessage, CodexCollabToolCallItem, CodexMcpToolCallItem, CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import { renderWithNativeDetails as render } from './portable-detail.test-fixtures'

/**
 * A `widget_code` call can come back with only the short acknowledgement the model read.
 * The phone keeps the call's whole input (`shouldKeepRemoteToolInput`), so it draws the
 * widget from that, through every adapter a call reaches the phone by. A subagent's card
 * stays a summary, as on the desktop, so a widget there keeps its tool row.
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

/** Answers each `subscribeDetail` with the detail the desktop projects for that reference. */
function serveDetails(details: Record<string, unknown>): () => void {
  return installFakeNativeHost((message, reply) => {
    if (message.action !== 'subscribeDetail') return
    const detail = details[String(message.payload?.detailRef ?? '')]
    queueMicrotask(() => reply(detail === undefined
      ? { error: 'Tool not found' }
      : { result: { subscriptionId: message.payload?.subscriptionId, revision: 0, offset: 0, text: JSON.stringify(detail) } }))
  })
}

async function expandCard(container: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(container.querySelector('.subagent-container > button')!) })
}

describe('a phone widget drawn from its call input', () => {
  let restore = () => {}
  afterEach(() => { restore(); restore = () => {} })

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

  it('keeps a widget a subagent showed as a tool row once its card is opened, like the desktop', async () => {
    const ref = JSON.stringify(['turn-1', 'tool', 'agent-claude'])
    restore = serveDetails({
      [ref]: {
        input: JSON.stringify({ description: 'Chart the releases', subagent_type: 'general-purpose', prompt: 'Chart them' }),
        result: 'Done.',
        // The child projection clears child results, as `toolDetail` sends them.
        childBlocks: [
          { type: 'tool_use', toolName: WIDGET, toolUseId: 'w', input: INPUT, status: 'complete', parentToolUseId: 'agent-claude' },
          { type: 'tool_result', toolUseId: 'w', summary: '', parentToolUseId: 'agent-claude' },
        ],
      },
    })
    const { container } = renderTurn(turn({
      providerId: 'claude',
      content: [
        { type: 'tool_use', toolName: 'Agent', toolUseId: 'agent-claude', input: JSON.stringify({ description: 'Chart the releases', subagent_type: 'general-purpose' }), status: 'complete', remoteDetail: ref },
        { type: 'tool_result', toolUseId: 'agent-claude', summary: 'Done.' },
      ],
    }))
    await expandCard(container)
    await waitFor(() => expect(container.textContent).toContain('Widget Generated'))
    expect(container.textContent).toContain('releases')
    expect(container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
    expect(widgetDocument(container)).toBeNull()
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

  it('keeps a widget a Codex subagent showed as a tool row once its deferred card is opened', async () => {
    const ref = JSON.stringify(['turn-1', 'tool', 'collab-1'])
    const collab: CodexCollabToolCallItem = {
      type: 'collab_tool_call',
      id: 'collab-1',
      tool: 'spawnAgent',
      status: 'completed',
      receiverThreadIds: ['child'],
      agentsStates: {},
    }
    restore = serveDetails({
      [ref]: {
        item: { ...collab, agentsStates: { child: { status: 'completed', nickname: 'charts' } }, childItems: { child: [codexWidget({ arguments: INPUT })] } },
        input: JSON.stringify({ prompt: 'Chart them' }),
        result: '{}',
      },
    })
    const { container } = renderTurn(codexTurn([{ ...collab, remoteDetail: ref }]))
    await expandCard(container)
    await waitFor(() => expect(container.textContent).toContain('Widget Generated'))
    expect(container.textContent).toContain('releases')
    expect(widgetDocument(container)).toBeNull()
  })
})
