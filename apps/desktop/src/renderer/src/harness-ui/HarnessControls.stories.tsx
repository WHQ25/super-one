import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { HarnessId, ModelOption } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import type { ChatStore } from '@/stores/chat-store/types'
import { HARNESS_CONTROLS } from './controls'
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
function seed(harness: HarnessId, empty: boolean): void {
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
          [sid]: { ...project._sessions[sid], preferredProvider: harness, sessionProvider: null, ...acp },
        },
      },
    },
  })
}

function Preview({ harness, empty = false, compact = false }: { harness: HarnessId; empty?: boolean; compact?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    seed(harness, empty)
    setReady(true)
    return () => useChatStore.setState(previous)
  }, [harness, empty])
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
export const Cursor: Story = { args: { harness: 'cursor' } }
export const DeepSeek: Story = { args: { harness: 'dsh' } }
/** Catalogs not loaded yet: each control shows its own empty state. */
export const EmptyCatalogs: Story = { args: { harness: 'acp', empty: true } }
/** Narrow composer: permission controls collapse to their compact trigger. */
export const Compact: Story = { args: { harness: 'cursor', compact: true } }
