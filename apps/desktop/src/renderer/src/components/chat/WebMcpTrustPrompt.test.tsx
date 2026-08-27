/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, WebmcpTrustConfirmPayload, WebmcpTrustToolSummary } from '@superone/shared/agent-types'
import { WebMcpTrustPrompt } from './WebMcpTrustPrompt'

const TOOLS: WebmcpTrustToolSummary[] = [
  { name: 'add_to_cart', description: 'Add a product to the cart by SKU.', annotations: { readOnlyHint: false } },
  { name: 'search_catalog', description: 'Search the catalog.', annotations: { readOnlyHint: true } },
  // The site declared nothing — neither claim chip may be invented for it.
  { name: 'track_order', description: '', annotations: {} },
]

function trustRequest(
  confirm: Partial<WebmcpTrustConfirmPayload> = {},
  request: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    requestId: 'p-webmcp',
    toolName: 'mcp__superone__browser_tools_list',
    input: {},
    allowAlwaysAllow: true,
    requestKind: 'webmcp_trust_confirm',
    webmcpTrustConfirm: {
      origin: 'https://shop.example.com',
      reason: 'first_use',
      tools: TOOLS,
      changedTools: [],
      ...confirm,
    },
    ...request,
  }
}

/**
 * The prompt scopes its window-level keydown listener to `[data-chat-root]`, so tests that
 * exercise shortcuts must render inside one — see `is-focus-in-chat`.
 */
function renderPrompt(request: PermissionRequest = trustRequest(), inChatRoot = true) {
  const onTrust = vi.fn()
  const onDeny = vi.fn()
  const prompt = <WebMcpTrustPrompt request={request} onTrust={onTrust} onDeny={onDeny} />
  const view = render(inChatRoot ? <div data-chat-root>{prompt}</div> : prompt)
  return { onTrust, onDeny, ...view }
}

function focusApprove(): void {
  screen.getByRole('button', { name: /Trust in this chat/ }).focus()
}

describe('WebMcpTrustPrompt', () => {
  it('names the origin and summarises what the site published', () => {
    renderPrompt()
    expect(screen.getByText('Page tools')).toBeTruthy()
    expect(screen.getByText('Trust page tools from https://shop.example.com?')).toBeTruthy()
    expect(screen.getByText('3 tools')).toBeTruthy()
    // One of the three claims to write — surfaced in the header before the list is read.
    expect(screen.getByText('1 change data')).toBeTruthy()
  })

  it('marks each tool with the claim the site made, and nothing when it made none', () => {
    const { container } = renderPrompt()
    const items = container.querySelectorAll('li')
    expect(Array.from(items).map((li) => li.querySelector('span')?.textContent)).toEqual([
      'add_to_cart',
      'search_catalog',
      'track_order',
    ])
    expect(within(items[0] as HTMLElement).getByText('changes data')).toBeTruthy()
    expect(within(items[1] as HTMLElement).getByText('read-only')).toBeTruthy()
    expect(items[2]?.textContent).toBe('track_order')
  })

  it('keeps every claim labelled as unverified page content', () => {
    renderPrompt()
    const hinted = screen.getAllByTitle('Declared by the site — not verified')
    expect(hinted.length).toBeGreaterThan(0)
    expect(screen.getByText(/written by the site and is not verified by SuperOne/)).toBeTruthy()
  })

  it('calls out the changed tools when a trusted site re-registers one', () => {
    const { container } = renderPrompt(
      trustRequest({
        reason: 'tool_changed',
        changedTools: ['add_to_cart', 'checkout'],
        tools: [{ ...TOOLS[0]!, changed: true }, TOOLS[1]!],
      }),
    )
    expect(screen.getByText('https://shop.example.com changed its page tools')).toBeTruthy()
    expect(screen.getByText(/re-registered add_to_cart, checkout with a different description/)).toBeTruthy()
    const items = container.querySelectorAll('li')
    expect(within(items[0] as HTMLElement).getByText('changed')).toBeTruthy()
    expect(within(items[1] as HTMLElement).queryByText('changed')).toBeNull()
  })

  it('shows no change warning on first use', () => {
    renderPrompt()
    expect(screen.queryByText(/re-registered/)).toBeNull()
    expect(screen.queryByText('changed')).toBeNull()
  })

  it('collapses to a pill and expands again', () => {
    renderPrompt()
    fireEvent.click(screen.getByText('Trust page tools from https://shop.example.com?'))
    expect(screen.getByText('https://shop.example.com is waiting for a trust decision')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Trust in this chat/ })).toBeNull()

    fireEvent.click(screen.getByText('https://shop.example.com is waiting for a trust decision'))
    expect(screen.getByRole('button', { name: /Trust in this chat/ })).toBeTruthy()
  })

  it('maps Enter / Shift+Enter / Escape onto the three decisions', () => {
    const { onTrust, onDeny } = renderPrompt()
    focusApprove()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onTrust).toHaveBeenCalledWith('session')

    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })
    expect(onTrust).toHaveBeenLastCalledWith('always')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDeny).toHaveBeenCalledTimes(1)
  })

  it('fires the same decisions from the buttons', () => {
    const { onTrust, onDeny } = renderPrompt()
    fireEvent.click(screen.getByRole('button', { name: /Trust in this chat/ }))
    fireEvent.click(screen.getByRole('button', { name: /Always trust/ }))
    fireEvent.click(screen.getByRole('button', { name: /Deny/ }))
    expect(onTrust).toHaveBeenNthCalledWith(1, 'session')
    expect(onTrust).toHaveBeenNthCalledWith(2, 'always')
    expect(onDeny).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts while an IME composition is open', () => {
    const { onTrust } = renderPrompt()
    focusApprove()
    fireEvent.keyDown(window, { key: 'Enter', isComposing: true })
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when focus is outside the chat pane', () => {
    const { onTrust, onDeny } = renderPrompt(trustRequest(), false)
    document.body.focus()
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onTrust).not.toHaveBeenCalled()
    expect(onDeny).not.toHaveBeenCalled()
  })

  it('reopens the collapsed pill with Space instead of deciding', () => {
    const { onTrust, onDeny } = renderPrompt()
    fireEvent.click(screen.getByText('Trust page tools from https://shop.example.com?'))
    screen.getByText('https://shop.example.com is waiting for a trust decision').closest('button')?.focus()

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onTrust).not.toHaveBeenCalled()
    expect(onDeny).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByRole('button', { name: /Trust in this chat/ })).toBeTruthy()
  })

  it('falls back to the raw input when the typed payload did not survive the hop', () => {
    const { container } = renderPrompt(
      trustRequest({}, {
        webmcpTrustConfirm: undefined,
        input: { origin: 'https://legacy.example.com', tools: ['do_thing', 42, 'other_thing'] },
      }),
    )
    expect(screen.getByText('Trust page tools from https://legacy.example.com?')).toBeTruthy()
    // Non-string entries are dropped rather than rendered as a bogus tool.
    expect(screen.getByText('2 tools')).toBeTruthy()
    expect(Array.from(container.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'do_thing',
      'other_thing',
    ])
    // Nothing is known about them, so no claim chip and no writer count may appear.
    expect(screen.queryByText(/change data/)).toBeNull()
  })
})
