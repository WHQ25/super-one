/**
 * Storybook: Settings → Harnesses → <harness> → Preferences tab.
 * The page renders inside the harness detail column, so the frame supplies
 * that column's padding. IPC and store resources are mocked per story.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ModelOption, SandboxCapability, SandboxProbeResult, SettingsProvider } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { PreferencesPage } from './PreferencesPage'

const PROJECT = '/Users/demo/projects/superone'

const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Most capable', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', name: 'Sonnet 5', description: 'Balanced', supportedEffortLevels: ['low', 'medium', 'high'] },
  { id: 'claude-haiku-5', name: 'Haiku 5', description: 'Fast' },
]

const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-5.5-codex', name: 'GPT-5.5 Codex', description: 'Default', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' }, { reasoningEffort: 'high', description: '' }] },
  { id: 'gpt-5.5-mini', name: 'GPT-5.5 Mini', description: 'Fast' },
] as ModelOption[]

type Scenario = {
  provider: SettingsProvider
  /** Pin the settings request so the rows stay in their loading (disabled) state. */
  loading?: boolean
  /** No models loaded yet: model and effort pickers are disabled. */
  noModels?: boolean
  sandbox?: { capability: SandboxCapability; probe: SandboxProbeResult | null }
  width?: number
}

function settingsFor(): unknown {
  return {
    dshSubagentModelSelection: { enabled: false, allowedModels: [] },
    agentPreference: {
      claude: { defaultModel: 'claude-opus-5-5', defaultEffort: 'high', defaultPermissionMode: '', defaultSandboxMode: '', askUserQuestionPreviewFormat: 'markdown' },
      codex: { defaultModel: 'gpt-5.5-codex', defaultReasoningEffort: 'medium', defaultPermissionPreset: '', defaultFastMode: false, realtimeVoice: 'cove' },
      opencode: { defaultPermissionMode: '' },
      acp: { defaultPermissionMode: '' },
      dsh: { defaultPermissionMode: '' },
      cursor: { defaultPermissionMode: '' },
    },
  }
}

function Frame({ scenario, children }: { scenario: Scenario; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    let settings = settingsFor() as Record<string, unknown>
    mockIpc('app', 'getAppSettings', () => (scenario.loading ? new Promise(() => {}) : Promise.resolve(settings)))
    mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
      const p = patch as { agentPreference?: Record<string, object> }
      const prev = settings.agentPreference as Record<string, object>
      const agentPreference = { ...prev }
      for (const [k, v] of Object.entries(p.agentPreference ?? {})) agentPreference[k] = { ...prev[k], ...v }
      settings = { ...settings, ...(patch as object), agentPreference }
      return settings
    })
    mockIpc('app', 'getProjectPreferences', async () => ({ outputStyle: '' }))
    mockIpc('app', 'saveProjectPreferences', async (_path: unknown, patch: unknown) => patch)
    mockIpc('app', 'listPlatforms', async () => [])
    mockIpc('app', 'listCredentials', async () => [])
    mockIpc('app', 'listBindings', async () => [])
    mockIpc('app', 'codexListModels', async () => (scenario.noModels ? [] : CODEX_MODELS))
    mockIpc('app', 'codexListRealtimeVoices', async () => ({ voices: ['cove', 'juniper', 'ember'], defaultVoice: 'cove' }))
    mockIpc('app', 'codexDetectExternalAgentConfig', async () => [])
    mockIpc('app', 'connectDeepseek', async () => ({ models: [] }))

    useSettingsStore.setState({ platforms: [], credentials: [], bindings: [], providerScope: 'local' })
    useAppStore.setState({
      currentFolder: PROJECT,
      settingsProvider: scenario.provider,
      sandboxCapability: scenario.sandbox?.capability ?? null,
      sandboxProbe: scenario.sandbox?.probe ?? null,
      probeSandbox: async () => {},
    } as never)
    const resources = useChatStore.getState().harnessResources
    useChatStore.setState({
      harnessResources: {
        ...resources,
        claude: {
          ...(resources.claude ?? {}),
          models: scenario.noModels ? [] : CLAUDE_MODELS,
          outputStyles: ['default', 'Explanatory', 'Learning'],
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
      <PreferencesPage provider={scenario.provider} />
    </Frame>
  )
}

const meta = {
  title: 'Settings/Harnesses/Preferences',
  component: Preview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

export const Claude: Story = { args: { provider: 'claude' } }
export const ClaudeLoading: Story = { args: { provider: 'claude', loading: true } }
export const ClaudeNoModels: Story = { args: { provider: 'claude', noModels: true } }
export const ClaudeSandboxMissing: Story = {
  args: {
    provider: 'claude',
    sandbox: {
      capability: { supportLevel: 'conditional', platform: 'linux', defaultMode: 'on' },
      probe: { ok: false, missing: ['bubblewrap', 'socat'], installHint: 'sudo apt-get install bubblewrap socat' },
    },
  },
}
export const ClaudeSandboxNotProbed: Story = {
  args: {
    provider: 'claude',
    sandbox: { capability: { supportLevel: 'conditional', platform: 'linux', defaultMode: 'on' }, probe: null },
  },
}
export const ClaudeSandboxUnsupported: Story = {
  args: {
    provider: 'claude',
    sandbox: { capability: { supportLevel: 'unsupported', platform: 'win32', defaultMode: 'off', unsupportedReason: 'Sandboxing is not available on Windows.' }, probe: null },
  },
}
export const Codex: Story = { args: { provider: 'codex' } }
export const DeepSeek: Story = { args: { provider: 'dsh' } }
export const OpenCode: Story = { args: { provider: 'opencode' } }
export const Narrow: Story = { args: { provider: 'claude', width: 420 } }
