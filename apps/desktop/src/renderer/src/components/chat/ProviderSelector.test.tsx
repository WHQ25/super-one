/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { ProviderSelector } from './ChatSuggestions'
import { createDefaultPerSessionState, createDefaultProjectState, SessionScopeProvider, useChatStore } from '@/stores/chat'
import { getActiveSessionView } from '@/stores/chat-store/selectors'
import { mosaicTileId, useMosaicStore } from '@/components/mosaic/mosaic-store'
import { makeLeaf } from '@/components/mosaic/mosaic-tree'

vi.mock('@/components/coding/ProjectSelector', () => ({ ProjectSelector: () => null }))
vi.mock('@/components/sidebar/add-project/AddProjectDialog', () => ({ AddProjectDialog: () => null }))

const NO_HARNESS = 'No harness enabled yet'

describe('ProviderSelector harness catalog', () => {
  beforeEach(() => {
    // The hint row resolves the effective provider on mount; without seeded provider
    // data its fetch runs against the mocked IPC and leaves the store undefined.
    useSettingsStore.setState({
      bindings: [], credentials: [], platforms: [], fetchProviderData: async () => {},
    })
    window.app.listHarnesses = vi.fn(async () => [
      { id: 'codex', enabled: true, state: 'installed', runtimeSource: 'bundled', requiresAuth: false },
    ])
  })

  it('keeps the harness row rendered when a new session id remounts the selector', async () => {
    const first = render(<ProviderSelector />)
    // An unloaded catalog is indistinguishable from an empty one, so the first ever
    // mount does show the empty state until `listHarnesses` answers.
    expect(screen.getByText(NO_HARNESS)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(NO_HARNESS)).not.toBeInTheDocument())
    first.unmount()

    // Switching harness on an empty session mints a new session id, which remounts
    // this component. Restarting from an unloaded catalog paints "No harness enabled
    // yet" for one IPC round trip — a flash in the middle of the chat.
    render(<ProviderSelector />)

    expect(screen.queryByText(NO_HARNESS)).not.toBeInTheDocument()
  })

  it('does not navigate from an idle evicted hidden mosaic pane back to the voice session', async () => {
    const project = createDefaultProjectState()
    project._activeSessionId = 'artifact'
    project._sessions = {
      voice: { ...createDefaultPerSessionState(), status: 'streaming', _historyHydrated: true, messages: [{ id: 'voice-message', providerId: 'claude', role: 'user', content: [], status: 'complete', createdAt: '' }] },
      artifact: { ...createDefaultPerSessionState(), _historyHydrated: true },
    }
    const switchToSession = vi.fn(async () => {})
    useChatStore.setState({ activeProject: '/p', projectSessions: { '/p': project }, mountedSessions: { '/p': ['voice', 'artifact'] }, switchToSession, setPreferredProvider: vi.fn(), initializeHarness: vi.fn(async () => {}) })
    const leaf = (id: string) => makeLeaf(mosaicTileId('/p', id), '/p', id)
    useMosaicStore.setState({ mode: 'mosaic', root: { type: 'branch', direction: 'row', ratio: 0.5, first: leaf('voice'), second: leaf('artifact') }, focusedTileId: leaf('artifact').id, lastLayout: null })
    window.app.queryHarnessSessionRanks = vi.fn(async () => [])
    window.app.getAppSettings = vi.fn(async () => ({ suggestionHarness: { provider: 'codex' } }) as never)
    const scope = { projectPath: '/p', sessionId: 'voice' }
    render(<SessionScopeProvider value={scope}><ProviderSelector /></SessionScopeProvider>)
    await waitFor(() => expect(window.app.getAppSettings).toHaveBeenCalled())
    await act(async () => { useMosaicStore.getState().exitToSingle() })
    switchToSession.mockClear()
    await act(async () => {
      useChatStore.getState().handleAgentEvent({ type: 'status_change', projectPath: '/p', sessionId: 'voice', status: 'idle' })
    })
    // Confirm the observed chain: hidden panes outlive protection, idle evicts
    // their session, and the scoped selector then exposes an empty default view.
    expect(useChatStore.getState().projectSessions['/p']._sessions.voice).toBeUndefined()
    expect(getActiveSessionView(scope).messages).toEqual([])
    expect(switchToSession).not.toHaveBeenCalled()
    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('artifact')
  })
})
