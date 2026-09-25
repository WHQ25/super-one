/**
 * Storybook: Settings → Harnesses → Cursor tab bodies (account, preferences,
 * models, cloud). IPC is mocked; the frame supplies the detail column padding.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useChatStore } from '@/stores/chat'
import { CursorAuthSettings, type CursorSettingsSection } from './CursorAuthSettings'

type Scenario = {
  section: CursorSettingsSection
  configured?: boolean
  cloud?: boolean
  cloudAgents?: 'none' | 'some' | 'long'
  models?: boolean
  width?: number
}

const CLOUD_AGENTS = [
  { agentId: 'bc-7f3a91d2', name: 'Fix flaky relay reconnect test', summary: 'Opened PR #412 with a retry around the websocket close handshake.' },
  { agentId: 'bc-02c4e8aa', name: 'Bump Electron to 44', summary: 'Waiting for CI.' },
]

const LONG_CLOUD_AGENTS = [
  ...CLOUD_AGENTS,
  {
    agentId: 'bc-9e1b0c55-long-identifier-for-a-very-long-running-cloud-agent',
    name: 'Refactor the settings pages into grouped cards with a compact sidebar and keep every behavior identical across harnesses',
    summary: 'A very long summary that should clamp to two lines inside the card row rather than pushing the archive and delete actions out of view on narrow windows.',
  },
]

function Frame({ scenario, children }: { scenario: Scenario; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    mockIpc('app', 'getCursorAuthStatus', async () => ({
      configured: !!scenario.configured,
      apiKeyName: scenario.configured ? 'superone-desktop' : null,
      userEmail: null,
    }))
    mockIpc('app', 'getCursorBaseConfig', async () => ({
      disabledModelIds: ['cursor-small'],
      runtime: scenario.cloud ? 'cloud' : 'local',
      settingSources: ['project', 'user'],
      toolPreset: 'readonly',
      cloudEnvType: 'cloud',
      repos: scenario.cloud ? [{ url: 'https://github.com/superone/superone' }] : [],
      cloudEnvVars: scenario.cloud ? { STAGING_API_TOKEN: '…' } : {},
    }))
    mockIpc('app', 'updateCursorBaseConfig', async () => ({}))
    mockIpc('app', 'cursorListRepositories', async () => [{ url: 'https://github.com/superone/superone' }])
    mockIpc('app', 'cursorListAgents', async () => ({
      items: scenario.cloudAgents === 'long' ? LONG_CLOUD_AGENTS : scenario.cloudAgents === 'some' ? CLOUD_AGENTS : [],
    }))
    mockIpc('app', 'cursorGetUsage', async () => ({
      usage: { inputTokens: 18200, outputTokens: 4100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 22300 },
      cost: { rawCostCents: 3.2, chargedCents: 3.2 },
      runs: [{ runId: 'run-1' }, { runId: 'run-2' }],
    }))
    mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
    const resources = useChatStore.getState().harnessResources
    useChatStore.setState({
      // Keep the mocked resources: initializeHarness would otherwise hit IPC.
      initializeHarness: async () => {},
      harnessResources: {
        ...resources,
        cursor: {
          ...(resources.cursor ?? {}),
          models: scenario.models
            ? [
                { id: 'composer-2', name: 'Composer 2', description: '' },
                { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: '' },
                { id: 'cursor-small', name: 'Cursor Small', description: '' },
              ]
            : [],
          disabledModelIds: ['cursor-small'],
        },
      },
    } as never)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only mock install
  }, [])

  return (
    <div
      className="bg-background px-7 pt-5 pb-8 text-foreground"
      style={{ width: scenario.width ?? 760, maxWidth: '100%' }}
    >
      {ready ? children : null}
    </div>
  )
}

function Preview(scenario: Scenario) {
  return (
    <Frame scenario={scenario}>
      <CursorAuthSettings section={scenario.section} />
    </Frame>
  )
}

const meta = {
  title: 'Settings/Harnesses/Cursor',
  component: Preview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

export const AccountMissingKey: Story = { args: { section: 'account' } }
export const AccountConfigured: Story = { args: { section: 'account', configured: true } }
export const Preferences: Story = { args: { section: 'preferences', configured: true } }
export const Models: Story = { args: { section: 'models', configured: true, models: true } }
export const ModelsEmpty: Story = { args: { section: 'models' } }
export const CloudOff: Story = { args: { section: 'cloud', configured: true } }
export const CloudEmpty: Story = { args: { section: 'cloud', configured: true, cloud: true, cloudAgents: 'none' } }
export const CloudWithAgents: Story = { args: { section: 'cloud', configured: true, cloud: true, cloudAgents: 'some' } }
export const CloudLongNarrow: Story = { args: { section: 'cloud', configured: true, cloud: true, cloudAgents: 'long', width: 420 } }
