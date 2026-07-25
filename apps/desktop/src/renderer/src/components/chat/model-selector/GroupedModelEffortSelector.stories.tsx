import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  GroupedModelEffortSelector,
  type SelectorAgentOption,
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
  withAgents = false,
}: {
  modelGroups?: SelectorModelGroup[]
  withAgents?: boolean
}) {
  const [modelId, setModelId] = useState('gpt-5.3-codex')
  const [effort, setEffort] = useState('high')
  const [providerId, setProviderId] = useState<string | null>('openai')
  const [agentId, setAgentId] = useState('build')

  return (
    <div className="flex min-h-80 items-end justify-center rounded-lg border bg-muted/20 p-6">
      <GroupedModelEffortSelector
        models={modelGroups ? undefined : MODELS}
        modelGroups={modelGroups}
        selectedModelId={modelId}
        onSelectModel={setModelId}
        effortOptions={EFFORTS}
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

export const GroupedModelList: Story = {
  render: () => <SelectorStory modelGroups={MODEL_GROUPS} />,
}

export const WithOpenCodeAgents: Story = {
  render: () => <SelectorStory modelGroups={MODEL_GROUPS} withAgents />,
}
