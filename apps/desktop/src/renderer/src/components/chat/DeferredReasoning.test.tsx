/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDetailClient } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { useAppStore } from '@/stores/app'
import { DesktopReasoning } from './ReasoningBlock'

const TEXT = 'Reasoning loaded from the remote node'

beforeEach(() => useAppStore.setState({ autoExpandReasoning: false }))
afterEach(cleanup)

function scenario() {
  let nextId = 0
  const values = new Map<string, unknown>()
  const scope = {
    environmentId: 'remote-node', sessionId: 'session',
    client: createDetailClient({
      subscribe: async (_target, subscriptionId) => ({ subscriptionId, revision: 0, offset: 0, text: TEXT }),
      unsubscribe: () => {},
    }, { newId: () => `detail-${++nextId}` }),
  }
  return (done: boolean, visible = true) => (
    <DetailScopeProvider scope={scope}>
      <TranscriptStateProvider values={values} scope="reasoning-row">
        {visible && <DesktopReasoning text="" remoteDetails={['think']} blockDone={done} />}
      </TranscriptStateProvider>
    </DetailScopeProvider>
  )
}

describe('remote reasoning completion', () => {
  it.each([
    { autoExpand: false, hidden: false },
    { autoExpand: true, hidden: false },
    { autoExpand: false, hidden: true },
    { autoExpand: true, hidden: true },
  ])('collapses after completion with autoExpand=$autoExpand and hidden=$hidden', async ({ autoExpand, hidden }) => {
    useAppStore.setState({ autoExpandReasoning: autoExpand })
    const view = scenario()
    const { container, rerender } = render(view(false))
    if (!autoExpand) fireEvent.click(screen.getByText(/^Thinking/))
    await screen.findByText(TEXT)

    if (hidden) rerender(view(false, false))
    await act(async () => { rerender(view(true)) })

    expect(screen.getByText(/^Thought/)).toBeVisible()
    expect(container.querySelector('.thinking-content')).toBeNull()

    // Reopening a completed row still loads its final detail and survives eviction.
    fireEvent.click(screen.getByText(/^Thought/))
    await screen.findByText(TEXT)
    rerender(view(true, false))
    rerender(view(true))
    await screen.findByText(TEXT)
  })

  it('keeps a completed row collapsed until opened and stays open when its detail loads', async () => {
    useAppStore.setState({ autoExpandReasoning: true })
    const view = scenario()
    const { container } = render(view(true))
    expect(container.querySelector('.thinking-content')).toBeNull()

    fireEvent.click(screen.getByText(/^Thought/))
    await waitFor(() => expect(screen.getByText(TEXT)).toBeVisible())
  })
})
