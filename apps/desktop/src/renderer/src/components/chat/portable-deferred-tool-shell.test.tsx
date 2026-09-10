/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { installHostBridge } from '@superone/chat-view/bridge'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * Fake native host: answers every `subscribeDetail` with the detail JSON registered for
 * that reference, the way the phone's RN layer relays the desktop's tool detail.
 */
function installFakeHost(details: Record<string, string>): () => void {
  const browser = globalThis as unknown as Window & {
    ReactNativeWebView?: { postMessage(message: string): void }
    __applyHost?: (message: unknown) => void
  }
  const dispose = installHostBridge(() => undefined)
  browser.ReactNativeWebView = {
    postMessage(raw: string) {
      const message = JSON.parse(raw) as { type: string; requestId: string; action: string; payload?: { detailRef?: string; subscriptionId?: string } }
      if (message.type !== 'requestNative' || message.action !== 'subscribeDetail') return
      const text = details[message.payload?.detailRef ?? '']
      queueMicrotask(() => {
        browser.__applyHost?.({
          type: 'nativeActionResult',
          requestId: message.requestId,
          ...(text === undefined
            ? { error: 'Tool not found' }
            : { result: { subscriptionId: message.payload?.subscriptionId, revision: 0, offset: 0, text } }),
        })
      })
    },
  }
  return () => { dispose(); delete browser.ReactNativeWebView }
}

/** Detail references are cached module-wide by the WebView, so each case needs its own. */
function detailRef(toolName: string): string {
  return JSON.stringify(['turn-1', 'tool', `call-${toolName}`])
}

/** The collapsed shell the desktop projects under progressive loading. */
function deferredTurn(toolName: string): ChatMessage {
  return {
    id: 'turn-1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'cursor',
    content: [
      { type: 'tool_use', toolName, toolUseId: 'call-1', input: '', status: 'complete', remoteDetail: detailRef(toolName) } as ContentBlock,
    ],
  } as ChatMessage
}

async function expandRow(container: HTMLElement): Promise<HTMLElement> {
  const row = container.querySelector<HTMLElement>('[data-tool-use-id="call-1"]')!
  expect(row).not.toBeNull()
  await act(async () => { fireEvent.click(row.querySelector('.tool-node-header')!) })
  return row
}

describe('deferred tool rows on the phone', () => {
  let restore: () => void
  beforeEach(() => { restore = () => undefined })
  afterEach(() => restore())

  it('shows the fetched result of a generic tool inside its own row, not a nested row', async () => {
    restore = installFakeHost({
      [detailRef('ReadLints')]: JSON.stringify({
        input: JSON.stringify({ paths: ['src/a.ts'] }),
        result: '{"totalDiagnostics":0}',
      }),
    })
    const { container } = render(
      <PortableMessage message={deferredTurn('ReadLints')} scheme="dark" pendingPermission={null} />,
    )
    const row = await expandRow(container)
    await waitFor(() => expect(row.textContent).toContain('totalDiagnostics'))
    // One chrome per call: the detail body must not be a second GenericToolRow.
    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
    expect(row.querySelector('.tool-node .tool-node')).toBeNull()
  })

  it('keeps a third-party MCP tool to a single row once its detail lands', async () => {
    restore = installFakeHost({
      [detailRef('mcp__context7__query_docs')]: JSON.stringify({ input: '{"query":"hooks"}', result: '{"content":[{"type":"text","text":"docs"}]}' }),
    })
    const { container } = render(
      <PortableMessage message={deferredTurn('mcp__context7__query_docs')} scheme="dark" pendingPermission={null} />,
    )
    const row = await expandRow(container)
    await waitFor(() => expect(row.textContent).toContain('docs'))
    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
  })

  it('still mounts a dedicated presenter for tools that have one', async () => {
    const roster = 'Peer sessions (1):\n  reviewer · codex · interactive · active 2m ago'
    restore = installFakeHost({ [detailRef('ListAgents')]: JSON.stringify({ input: '{}', result: roster }) })
    const { container } = render(
      <PortableMessage message={deferredTurn('ListAgents')} scheme="dark" pendingPermission={null} />,
    )
    const row = await expandRow(container)
    await waitFor(() => expect(row.textContent).toContain('reviewer'))
  })
})
