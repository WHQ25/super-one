import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { HarnessId, ModelOption, SessionAgentProfile } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import type { ChatStore } from '@/stores/chat-store/types'
import { HARNESS_CONTROLS } from './controls'
import type { LaunchModelPatch } from './launch-model'
import { mockIpc } from '../../../../.storybook/mock-ipc'

const PROJECT = '/storybook/harness-controls'

for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts', 'codexListAccounts']) {
  mockIpc('app', method, async () => [])
}

const model = (id: string, name: string, extra: Partial<ModelOption> = {}): ModelOption => ({ id, name, description: '', ...extra })

const CATALOGS = {
  claude: { models: [model('opus', 'Opus', { isDefault: true, supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] }), model('sonnet', 'Sonnet')], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] },
  codex: { models: [model('gpt-6.1-sol', 'GPT6.1 Sol', { isDefault: true, supportedReasoningEfforts: [{ value: 'medium', description: '' }, { value: 'high', description: '' }], defaultReasoningEffort: 'medium' })], prompts: [] },
  opencode: { models: [model('openai/gpt-6.1-sol', 'GPT-6.1 Sol'), model('anthropic/opus', 'Opus')], agents: [{ id: 'build', name: 'Build', description: '' }, { id: 'plan', name: 'Plan', description: '' }], commands: [] },
  cursor: { models: [model('default', 'Auto', { isDefault: true }), model('claude-opus-5-5', 'Claude Opus 5.5')], disabledModelIds: [] },
  dsh: { models: [model('deepseek-v4-pro', 'DeepSeek V4 Pro', { isDefault: true })] },
} as const

/** A session on `harness` with its catalog loaded, or every catalog empty. */
function seed(harness: HarnessId, empty: boolean, scopedCatalog: boolean): void {
  useChatStore.getState().ensureSession(PROJECT)
  const project = useChatStore.getState().projectSessions[PROJECT]
  const sid = project._activeSessionId!
  const acp = empty ? {} : {
    acpAgentId: 'grok-build',
    acpModels: [model('grok-4.7', 'Grok 4.7')],
    acpModelsStatus: 'ready' as const,
    acpModes: [model('ask', 'Ask'), model('code', 'Code')],
    acpModeConfigId: 'mode',
    selectedAcpModeId: 'code',
    acpModesStatus: 'ready' as const,
  }
  useChatStore.setState({
    activeProject: PROJECT,
    harnessResources: (empty ? { claude: null, codex: null, acp: null } : { ...CATALOGS, acp: null }) as unknown as ChatStore['harnessResources'],
    projectSessions: {
      [PROJECT]: {
        ...project,
        _sessions: {
          ...project._sessions,
          [sid]: { ...project._sessions[sid], preferredProvider: harness, sessionProvider: null, ...acp,
            ...(scopedCatalog ? { runtimeCapabilities: { harnessId: 'opencode', supportsQueuedSteer: true },
              sessionModels: [model('superone_node_fixture/fixture', 'Private coding model', { providerName: 'Team gateway', isDefault: true })],
              selectedModel: 'superone_node_fixture/fixture' } : {}),
          },
        },
      },
    },
  })
}

function Preview({ harness, empty = false, compact = false, scopedCatalog = false }: { harness: HarnessId; empty?: boolean; compact?: boolean; scopedCatalog?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    seed(harness, empty, scopedCatalog)
    setReady(true)
    return () => useChatStore.setState(previous)
  }, [harness, empty, scopedCatalog])
  if (!ready) return null
  const { ModelControl, PermissionControl } = HARNESS_CONTROLS[harness]
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3" style={{ width: compact ? 300 : 560 }}>
      <ModelControl />
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-border" />
      <PermissionControl compact={compact} />
    </div>
  )
}

const meta = {
  title: 'Harness UI/Controls',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

export const Claude: Story = { args: { harness: 'claude' } }
export const Codex: Story = { args: { harness: 'codex' } }
/** ACP: permission baseline plus the agent's own session modes. */
export const Acp: Story = { args: { harness: 'acp' } }
/** OpenCode has no permission modes; its agent picker takes the slot. */
export const OpenCode: Story = { args: { harness: 'opencode' } }
export const OpenCodeNodeCredential: Story = { args: { harness: 'opencode', scopedCatalog: true } }
export const OpenCodeNodeCredentialNarrow: Story = { args: { harness: 'opencode', scopedCatalog: true, compact: true } }
export const Cursor: Story = { args: { harness: 'cursor' } }
export const DeepSeek: Story = { args: { harness: 'dsh' } }
/** Catalogs not loaded yet: each control shows its own empty state. */
export const EmptyCatalogs: Story = { args: { harness: 'acp', empty: true } }
/** Narrow composer: permission controls collapse to their compact trigger. */
export const Compact: Story = { args: { harness: 'cursor', compact: true } }

const LAUNCH_HARNESSES: HarnessId[] = ['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh']
const ACP_RESOURCES = {
  agents: [],
  selectedAgentId: 'grok-build',
  configByAgentId: {
    // Grok legacy effort: modes outside configOptions with no config id.
    'grok-build': { configOptions: [], extraModels: [model('grok-4.7', 'Grok 4.7')], extraModes: [model('high', 'High Effort'), model('low', 'Low Effort')] },
  },
}
const remoteProfile = (harnessId: HarnessId): SessionAgentProfile => ({
  id: harnessId,
  name: harnessId,
  harnessId,
  brandKey: harnessId,
  defaultConfig: {},
  models: [{ id: 'remote-model', name: 'Remote Model' }],
  efforts: ['low', 'high'],
  apiProviders: [],
})

mockIpc('app', 'codexListModels', async () => CATALOGS.codex.models)

function LaunchRow({ harness, remote }: { harness: HarnessId; remote: boolean }) {
  const [config, setConfig] = useState<LaunchModelPatch>({})
  const { LaunchModelControl } = HARNESS_CONTROLS[harness]
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/20 px-1 py-0.5">
      <span className="w-16 shrink-0 px-1 text-xs text-muted-foreground">{harness}</span>
      <LaunchModelControl
        profile={remote ? remoteProfile(harness) : undefined}
        catalog={remote ? 'profile' : 'local'}
        apiProviderId={config.apiProviderId}
        model={config.model}
        effort={config.effort}
        offerFastMode
        fastMode={config.fastMode}
        onChange={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
      />
    </div>
  )
}

/** Launch rows (collab / automation confirm) for every harness, before a session exists. */
function LaunchPreview({ remote = false, empty = false }: { remote?: boolean; empty?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    useChatStore.setState({
      activeProject: PROJECT,
      harnessResources: (empty
        ? { claude: null, codex: null, acp: null }
        : { ...CATALOGS, acp: ACP_RESOURCES }) as unknown as ChatStore['harnessResources'],
    })
    setReady(true)
    return () => useChatStore.setState(previous)
  }, [empty])
  if (!ready) return null
  return (
    <div className="flex flex-col gap-2" style={{ width: 560 }}>
      {LAUNCH_HARNESSES.map((harness) => <LaunchRow key={harness} harness={harness} remote={remote} />)}
    </div>
  )
}

/** Local launch rows read this machine's live catalogs; ACP shows Grok effort, not session modes. */
export const LaunchRows: Story = { args: { harness: 'claude' }, render: () => <LaunchPreview /> }
/** A launch on another machine reads only the target's profile. */
export const LaunchRowsRemote: Story = { args: { harness: 'claude' }, render: () => <LaunchPreview remote /> }
/** Catalogs not loaded yet. */
export const LaunchRowsEmpty: Story = { args: { harness: 'claude' }, render: () => <LaunchPreview empty /> }

/** Empty-chat harness picker marks: Grok for the default ACP agent, the ACP glyph for others. */
export const PickerIcons: Story = {
  args: { harness: 'claude' },
  render: () => (
    <div className="flex items-end gap-6">
      {LAUNCH_HARNESSES.map((harness) => {
        const { PickerIcon } = HARNESS_CONTROLS[harness]
        return <PickerIcon key={harness} size={48} acpAgentId={harness === 'acp' ? 'grok-build' : null} />
      })}
      {(() => {
        const { PickerIcon } = HARNESS_CONTROLS.acp
        return <PickerIcon size={48} acpAgentId="gemini" />
      })()}
    </div>
  ),
}
