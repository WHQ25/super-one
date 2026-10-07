import { useState } from 'react'
import { Toaster, toast } from 'sonner'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  GroupedModelEffortSelector,
  type SelectorAgentOption,
  type SelectorCatalogParam,
  type SelectorEffortOption,
  type SelectorModelGroup,
  type SelectorModelOption,
  type SelectorProviderOption,
} from './GroupedModelEffortSelector'

const MODELS: SelectorModelOption[] = [
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', description: 'Recommended' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2-Codex', description: 'Balanced' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1-Codex', description: 'Fast' },
  { id: 'gpt-5.0-codex', name: 'GPT-5.0-Codex', description: 'Stable' },
  { id: 'gpt-4.2-codex', name: 'GPT-4.2-Codex', description: 'Legacy' },
  { id: 'gpt-4.1-codex', name: 'GPT-4.1-Codex', description: 'Legacy' },
  { id: 'gpt-4o-codex', name: 'GPT-4o-Codex', description: 'Legacy' },
]

const MODEL_GROUPS: SelectorModelGroup[] = [
  { id: 'gpt-5', name: 'GPT-5', models: MODELS.slice(0, 4) },
  { id: 'gpt-4', name: 'GPT-4', models: MODELS.slice(4) },
]

const EFFORTS: SelectorEffortOption[] = [
  { value: 'minimal', label: 'Minimal', description: 'Fastest, least thorough reasoning' },
  { value: 'low', label: 'Low', description: 'Quick answers with light reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced speed and depth' },
  { value: 'high', label: 'High', description: 'Deeper reasoning, slower responses' },
  { value: 'xhigh', label: 'Extra high', description: 'Maximum reasoning for hard problems' },
]

const PROVIDERS: SelectorProviderOption[] = [
  { id: 'openai', name: 'OpenAI', brand: 'openai' },
  { id: 'deepseek', name: 'DeepSeek', brand: 'deepseek', keyName: 'personal' },
  { id: 'nvidia', name: 'NVIDIA', brand: 'nvidia', keyName: 'work' },
  { id: 'custom', name: 'Custom API', brand: null, keyName: 'endpoint' },
]

const AGENTS: SelectorAgentOption[] = [
  { id: 'build', name: 'build', description: 'Full-access coding agent' },
  { id: 'plan', name: 'plan', description: 'Read-only planning agent' },
  { id: 'general', name: 'general', description: 'General-purpose assistant' },
]

function SelectorStory({
  modelGroups,
  models = MODELS,
  effortOptions = EFFORTS,
  withAgents = false,
}: {
  modelGroups?: SelectorModelGroup[]
  models?: SelectorModelOption[]
  effortOptions?: SelectorEffortOption[]
  withAgents?: boolean
}) {
  const [modelId, setModelId] = useState('gpt-5.3-codex')
  const [effort, setEffort] = useState('high')
  const [providerId, setProviderId] = useState<string | null>('openai')
  const [agentId, setAgentId] = useState('build')

  return (
    <div className="flex min-h-80 items-end justify-center rounded-lg border bg-muted/20 p-6">
      <GroupedModelEffortSelector
        models={modelGroups ? undefined : models}
        modelGroups={modelGroups}
        selectedModelId={modelId}
        onSelectModel={setModelId}
        effortOptions={effortOptions}
        selectedEffort={effort}
        onSelectEffort={setEffort}
        agents={withAgents ? AGENTS : undefined}
        selectedAgentId={withAgents ? agentId : undefined}
        onSelectAgent={withAgents ? setAgentId : undefined}
        providers={PROVIDERS}
        selectedProviderId={providerId}
        onSelectProvider={setProviderId}
        onManageProviders={() => undefined}
      />
    </div>
  )
}

const meta: Meta<typeof GroupedModelEffortSelector> = {
  title: 'Chat/GroupedModelEffortSelector',
  component: GroupedModelEffortSelector,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof GroupedModelEffortSelector>

export const FlatModelList: Story = {
  render: () => <SelectorStory />,
}

const LONG_DESCRIPTION_MODELS = MODELS.map((model) => ({
  ...model,
  description: 'A model for demanding coding tasks and everyday work across large projects.',
}))

export const ScrollableModelList: Story = {
  render: () => <SelectorStory models={LONG_DESCRIPTION_MODELS} effortOptions={[]} />,
}

export const ShortModelList: Story = {
  render: () => <SelectorStory models={LONG_DESCRIPTION_MODELS.slice(0, 2)} effortOptions={[]} />,
}

export const GroupedModelList: Story = {
  render: () => <SelectorStory modelGroups={MODEL_GROUPS} />,
}

export const WithOpenCodeAgents: Story = {
  render: () => <SelectorStory modelGroups={MODEL_GROUPS} withAgents />,
}

function CodexAccountsStory() {
  const [providerId, setProviderId] = useState<string | null>('codex-account:11111111-1111-4111-8111-111111111111')
  return <div className="flex min-h-96 items-end justify-center p-6">
    <GroupedModelEffortSelector
      models={[{ id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' }]}
      selectedModelId="gpt-5.3-codex" onSelectModel={() => {}}
      effortOptions={EFFORTS} selectedEffort="high" onSelectEffort={() => {}}
      providers={[
        { id: 'codex-account:11111111-1111-4111-8111-111111111111', brand: 'openai', name: 'ChatGPT', keyName: 'personal@example.com · plus' },
        { id: 'codex-account:22222222-2222-4222-8222-222222222222', brand: 'openai', name: 'ChatGPT', keyName: 'work@example.com · pro' },
      ]}
      selectedProviderId={providerId} onSelectProvider={setProviderId} onManageProviders={() => {}}
    />
  </div>
}

export const CodexAccounts: Story = { render: () => <CodexAccountsStory /> }

function CodexManualRefreshStory() {
  const [loading, setLoading] = useState(false)
  return <div className="flex min-h-80 items-end justify-center p-6">
    <GroupedModelEffortSelector
      models={MODELS.slice(0, 2)}
      selectedModelId={MODELS[0].id} onSelectModel={() => {}}
      effortOptions={EFFORTS} selectedEffort="high" onSelectEffort={() => {}}
      modelsLoading={loading}
      onRefreshModels={() => {
        setLoading(true)
        window.setTimeout(() => {
          setLoading(false)
          toast.success('Codex returned 2 models.')
        }, 800)
      }}
    />
    <Toaster position="bottom-center" />
  </div>
}

export const CodexManualRefresh: Story = { render: () => <CodexManualRefreshStory /> }

/** A toggle under Options with a hint line, as Claude's Ultracode switch shows. Open the menu to see it. */
function ToggleOptionWithHintStory() {
  const [modelId, setModelId] = useState('gpt-5.3-codex')
  const [effort, setEffort] = useState('xhigh')
  const [on, setOn] = useState(true)
  const params: SelectorCatalogParam[] = [{
    id: 'ultracode',
    label: 'Ultracode',
    kind: 'toggle',
    values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
    selected: on ? 'true' : 'false',
    description: 'Use dynamic workflows on every task in this session.',
  }]
  return (
    <div className="flex min-h-80 items-end justify-center rounded-lg border bg-muted/20 p-6">
      <GroupedModelEffortSelector
        models={MODELS}
        selectedModelId={modelId}
        onSelectModel={setModelId}
        effortOptions={EFFORTS}
        selectedEffort={effort}
        onSelectEffort={setEffort}
        optionParams={params}
        onOptionParamChange={(_, value) => setOn(value === 'true')}
      />
    </div>
  )
}

export const ToggleOptionWithHint: Story = { render: () => <ToggleOptionWithHintStory /> }
