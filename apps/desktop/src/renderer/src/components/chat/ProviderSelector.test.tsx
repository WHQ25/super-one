/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { ChatSuggestions, ProviderSelector, resetProviderSelectorMemoryForTests } from './ChatSuggestions'
import { useAppStore } from '@/stores/app'
import { resetEnvironmentListCache } from '@/lib/environment-list'
import type { EnvironmentListItem, HarnessInstallationStatus } from '@superone/shared/environment'
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

  it('does not show the install/restart hint when acp-antigravity is enabled and ready in the harness catalog', async () => {
    window.app.listHarnesses = vi.fn(async () => [
      { id: 'acp-grok', enabled: true, state: 'ready', runtimeSource: 'external', requiresAuth: true },
      { id: 'acp-antigravity', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: true },
    ])
    window.app.queryHarnessSessionRanks = vi.fn(async () => [])
    window.app.getAppSettings = vi.fn(async () => ({}) as never)

    const project = createDefaultProjectState()
    project._activeSessionId = 's1'
    project._sessions = {
      s1: {
        ...createDefaultPerSessionState(),
        _historyHydrated: true,
        preferredProvider: 'acp-grok',
        sessionProvider: 'acp-grok',
        acpAgentId: 'antigravity',
        harnessUserChosen: true,
      },
    }
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: { '/p': project },
      harnessResources: {
        ...useChatStore.getState().harnessResources,
        'acp-grok': {
          agents: [
            { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
            // Stale startup cache before ACP agent re-detection completes:
            { id: 'antigravity', name: 'Antigravity', installed: false, commandPreview: 'agy --acp' },
          ],
          selectedAgentId: 'antigravity',
          modelsByAgentId: {},
          configByAgentId: {},
        },
      },
      initializeHarness: vi.fn(async () => {}),
    })

    render(<ProviderSelector />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Antigravity' })).toBeInTheDocument()
      expect(
        screen.queryByText('Install this CLI on your machine, then restart SuperOne.'),
      ).not.toBeInTheDocument()
    })
  })

  it('marks harnessUserChosen when manually switching from Grok Build to Antigravity so default harness auto-apply does not snap back', async () => {
    resetProviderSelectorMemoryForTests()
    window.app.listHarnesses = vi.fn(async () => [
      { id: 'acp-grok', enabled: true, state: 'ready', runtimeSource: 'external', requiresAuth: true },
      { id: 'acp-antigravity', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: true },
    ])
    window.app.queryHarnessSessionRanks = vi.fn(async () => [])
    window.app.getAppSettings = vi.fn(async () => ({
      suggestionHarness: { provider: 'acp-grok', acpAgentId: 'grok-build' },
      secondaryHarness: { provider: 'acp-grok', acpAgentId: 'antigravity' },
    }) as never)
    window.app.saveAppSettings = vi.fn(async () => ({}) as never)

    const project = createDefaultProjectState()
    project._activeSessionId = 's1'
    project._sessions = {
      s1: {
        ...createDefaultPerSessionState(),
        _historyHydrated: true,
        preferredProvider: 'acp-grok',
        sessionProvider: 'acp-grok',
        acpAgentId: 'grok-build',
        harnessUserChosen: false,
      },
    }
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: { '/p': project },
      harnessResources: {
        ...useChatStore.getState().harnessResources,
        'acp-grok': {
          agents: [
            { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
            { id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy --acp' },
          ],
          selectedAgentId: 'grok-build',
          modelsByAgentId: {},
          configByAgentId: {},
        },
      },
      initializeHarness: vi.fn(async () => {}),
    })

    render(<ProviderSelector />)
    const antigravityTab = await screen.findByRole('tab', { name: 'Antigravity' })

    await act(async () => {
      antigravityTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      antigravityTab.click()
    })

    await waitFor(() => {
      const sess = useChatStore.getState().projectSessions['/p']._sessions.s1
      expect(sess.acpAgentId).toBe('antigravity')
      expect(sess.harnessUserChosen).toBe(true)
    })
    resetProviderSelectorMemoryForTests()
  })
})

describe('Chat Suggestions host selection', () => {
  const appState = useAppStore.getState()
  const chatState = useChatStore.getState()
  const environment = window.environment
  const localCatalog: HarnessInstallationStatus[] = [
    { id: 'codex', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: true },
    { id: 'acp-antigravity', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: false },
  ]
  const listItems = vi.fn()

  beforeEach(() => {
    resetEnvironmentListCache()
    const node: EnvironmentListItem = {
      connectionId: 'node-1', environmentId: 'env-1', label: 'Remote node',
      kind: 'remote', state: 'connected', endpointProfiles: [],
      capabilities: { methods: [], harnessIds: ['codex', 'acp-grok'], coldSessionResume: true, turnReattach: false, hostActionV1: false },
    }
    listItems.mockReset().mockResolvedValue([node])
    window.environment = new Proxy(environment, {
      get: (target, key) => key === 'listItems' ? listItems
        : key === 'listProjects' ? async () => [] : Reflect.get(target, key),
    })
    useAppStore.setState({
      currentFolder: null, tmpFolder: null, selectedHostConnectionId: 'local',
      isSwitchingHostProject: false, harnessCatalog: localCatalog,
      experimentalAgentsEnabled: false, enabledExperimentalAgents: [], recentFolders: [],
    })
    useChatStore.setState({
      activeProject: null, projectSessions: {},
      initializeHarness: vi.fn(async () => {}),
      harnessResources: {
        claude: null, codex: null,
        'acp-grok': {
          agents: [
            { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
            { id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy --acp' },
          ],
          selectedAgentId: 'antigravity', modelsByAgentId: {}, configByAgentId: {},
        },
        'acp-antigravity': null,
      },
    })
    window.app.listHarnesses = vi.fn(async () => localCatalog)
    window.app.queryHarnessSessionRanks = vi.fn(async () => [])
    window.app.getAppSettings = vi.fn(async () => ({}) as never)
    useSettingsStore.setState({ bindings: [], credentials: [], platforms: [], fetchProviderData: async () => {} })
  })

  afterEach(() => {
    cleanup()
    resetEnvironmentListCache()
    window.environment = environment
    useAppStore.setState(appState)
    useChatStore.setState(chatState)
  })

  it('replaces local Antigravity with the selected node’s Grok before opening a project, then restores it on local', async () => {
    render(<ChatSuggestions />)
    expect(await screen.findByRole('tab', { name: 'Antigravity' })).toBeInTheDocument()

    act(() => useAppStore.setState({ selectedHostConnectionId: 'node-1' }))
    // The previous machine must disappear immediately, even while discovery is pending.
    expect(screen.queryByRole('tab', { name: 'Antigravity' })).not.toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'Grok Build' })).toBeInTheDocument()
    expect(screen.queryByText('Antigravity')).not.toBeInTheDocument()
    expect(useChatStore.getState().activeProject).toBeNull()

    act(() => useAppStore.setState({ selectedHostConnectionId: 'local' }))
    expect(await screen.findByRole('tab', { name: 'Antigravity' })).toBeInTheDocument()
    expect(screen.queryByText('Grok Build')).not.toBeInTheDocument()
  })

  it('does not offer local Antigravity when the selected node has no ready harnesses', async () => {
    listItems.mockResolvedValue([{ connectionId: 'node-1', state: 'connected', capabilities: { harnessIds: [] } }])
    useAppStore.setState({ selectedHostConnectionId: 'node-1' })
    render(<ChatSuggestions />)
    await waitFor(() => expect(listItems).toHaveBeenCalled())
    expect(screen.getByText(NO_HARNESS)).toBeInTheDocument()
    expect(screen.queryByText('Antigravity')).not.toBeInTheDocument()
  })

  it('keeps a scoped pane on its project’s machine when the landing host changes', async () => {
    const projectPath = 'remote:node-1:/repo'
    const session = { ...createDefaultPerSessionState(), preferredProvider: 'codex' as const, harnessUserChosen: true, _historyHydrated: true }
    useChatStore.setState({
      activeProject: projectPath,
      projectSessions: { [projectPath]: { ...createDefaultProjectState(), _activeSessionId: 's1', _sessions: { s1: session } } },
    })
    useAppStore.setState({ currentFolder: projectPath, selectedHostConnectionId: 'local' })
    render(<SessionScopeProvider value={{ projectPath, sessionId: 's1' }}><ChatSuggestions /></SessionScopeProvider>)
    expect(await screen.findByRole('tab', { name: 'Grok Build' })).toBeInTheDocument()
    expect(screen.queryByText('Antigravity')).not.toBeInTheDocument()
  })
})
