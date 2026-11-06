import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import type { EnvironmentListItem, HarnessInstallationStatus } from '@superone/shared/environment'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type PerSessionState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { resetEnvironmentListCache } from '@/lib/environment-list'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ChatSuggestions } from './ChatSuggestions'

const localCatalog: HarnessInstallationStatus[] = [
  { id: 'codex', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: true },
  { id: 'acp-antigravity', enabled: true, state: 'ready', runtimeSource: 'managed', requiresAuth: false },
]
type Scenario = 'ready' | 'empty' | 'loading' | 'error'

function HostPreview({ scenario = 'ready', narrow = false }: { scenario?: Scenario; narrow?: boolean }) {
  const [ready, setReady] = useState(false)
  const host = useAppStore((s) => s.selectedHostConnectionId)
  useEffect(() => {
    const app = useAppStore.getState()
    const chat = useChatStore.getState()
    const settings = useSettingsStore.getState()
    const environment = window.environment
    const path = '/storybook-landing'
    const session: PerSessionState = { ...createDefaultPerSessionState(), preferredProvider: 'codex', harnessUserChosen: true }
    const update = (patch: Partial<PerSessionState>) => useChatStore.setState((s) => ({
      projectSessions: { ...s.projectSessions, [path]: {
        ...s.projectSessions[path], _sessions: { s1: { ...s.projectSessions[path]._sessions.s1, ...patch } },
      } },
    }))
    useChatStore.setState({
      activeProject: path,
      projectSessions: { [path]: { ...createDefaultProjectState(), _activeSessionId: 's1', _sessions: { s1: session } } },
      initializeHarness: async () => {},
      setPreferredProvider: (provider) => update({ preferredProvider: provider, sessionProvider: null }),
      setAcpAgentId: (acpAgentId) => update({ acpAgentId }),
      harnessResources: { claude: null, codex: null, acp: {
        agents: [
          { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
          { id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy --acp' },
        ],
        selectedAgentId: 'antigravity', modelsByAgentId: {}, configByAgentId: {},
      } },
    })
    useAppStore.setState({
      selectedHostConnectionId: scenario === 'ready' ? 'local' : 'remote-node',
      currentFolder: null, tmpFolder: null, recentFolders: [],
      isSwitchingHostProject: false, harnessCatalog: localCatalog,
      experimentalAgentsEnabled: false, enabledExperimentalAgents: [],
    })
    useSettingsStore.setState({ bindings: [], credentials: [], platforms: [], fetchProviderData: async () => {} })
    mockIpc('app', 'listHarnesses', async () => localCatalog)
    mockIpc('app', 'queryHarnessSessionRanks', async () => [])
    mockIpc('app', 'getAppSettings', async () => ({}))
    mockIpc('app', 'saveAppSettings', async () => {})
    const node: EnvironmentListItem = {
      connectionId: 'remote-node', environmentId: 'remote-env',
      label: 'Remote development workstation with a long name',
      kind: 'remote', state: 'connected', endpointProfiles: [],
      capabilities: { methods: [], harnessIds: scenario === 'empty' ? [] : ['codex', 'acp'], coldSessionResume: true, turnReattach: false, hostActionV1: false },
    }
    const listItems = async () => {
      if (scenario === 'loading') return new Promise<EnvironmentListItem[]>(() => {})
      if (scenario === 'error') throw new Error('Remote host unavailable')
      return [node]
    }
    window.environment = new Proxy(environment, {
      get: (target, key) => key === 'listItems' ? listItems
        : key === 'listProjects' ? async () => [] : Reflect.get(target, key),
    })
    resetEnvironmentListCache()
    setReady(true)
    return () => {
      resetEnvironmentListCache()
      window.environment = environment
      useAppStore.setState(app)
      useChatStore.setState(chat)
      useSettingsStore.setState(settings)
    }
  }, [scenario])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    <label className="mb-6 flex flex-col gap-2 text-sm">Host
      <select aria-label="Host" className="rounded border bg-background p-2" value={host}
        onChange={(event) => useAppStore.setState({ selectedHostConnectionId: event.target.value })}>
        <option value="local">Local computer</option>
        <option value="remote-node">Remote development workstation with a long name</option>
      </select>
    </label>
    <div className="h-80">{ready && <ChatSuggestions />}</div>
  </div>
}

const meta = { title: 'Chat/ChatSuggestions', component: ChatSuggestions, parameters: { layout: 'padded' } } satisfies Meta<typeof ChatSuggestions>
export default meta
type Story = StoryObj<typeof meta>

export const SwitchHost: Story = {
  render: () => <HostPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('tab', { name: 'Antigravity' })
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Host' }), 'remote-node')
    await canvas.findByRole('tab', { name: 'Grok Build' })
    expect(canvas.queryByText('Antigravity')).toBeNull()
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Host' }), 'local')
    await canvas.findByRole('tab', { name: 'Antigravity' })
  },
}
export const SwitchHostDark: Story = { ...SwitchHost, globals: { theme: 'dark' } }
export const SwitchHostChinese: Story = { ...SwitchHost, globals: { locale: 'zh' } }
export const Narrow: Story = { render: () => <HostPreview narrow /> }
export const EmptyNode: Story = { render: () => <HostPreview scenario="empty" /> }
export const LoadingNode: Story = { render: () => <HostPreview scenario="loading" /> }
export const UnavailableNode: Story = { render: () => <HostPreview scenario="error" /> }
