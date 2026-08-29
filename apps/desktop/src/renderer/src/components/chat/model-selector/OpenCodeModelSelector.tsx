import { useMemo } from 'react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { selectOpenCodeAgents, useActiveSession, useChatStore, useScopedSessionActions } from '@/stores/chat'
import { resolveDefaultOpenCodeAgent } from '@/stores/chat-store/harness/opencode-handler'
import { groupModelsBySlashPrefix, resolveSlashModelLabel, splitSlashModelId } from '../ModelSelectorLists'
import {
  GroupedModelEffortSelector,
  type SelectorAgentOption,
  type SelectorModelGroup,
} from './GroupedModelEffortSelector'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

function resolveEffortForModel(
  levels: EffortLevel[],
  preferred: EffortLevel | null | undefined,
): EffortLevel | undefined {
  if (preferred && levels.includes(preferred)) return preferred
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

export function OpenCodeModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const resources = useChatStore((state) => state.harnessResources.opencode)
  const agents = useChatStore(selectOpenCodeAgents)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const selectedAgentId = useActiveSession((state) => state.openCodeAgentId)
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const { setSelectedModel, setSelectedEffort, setOpenCodeAgentId } = useScopedSessionActions()

  const isPlanMode = permissionMode === 'plan'
  const effectiveAgentId = isPlanMode
    ? 'plan'
    : (selectedAgentId ?? resolveDefaultOpenCodeAgent(agents))
  const selectedAgent = agents.find((agent) => agent.id === effectiveAgentId)
  const agentLabel = isPlanMode ? 'Plan' : (selectedAgent?.name ?? 'Agent')

  const current = resources?.models.find((model) => model.id === selectedModel)
  // Prefer catalog display name; if selection is not in OpenCode catalog (stale race),
  // show a neutral label instead of another harness's model id.
  const modelLabel = current
    ? resolveSlashModelLabel(current)
    : (resources?.models.length ? 'OpenCode' : (splitSlashModelId(selectedModel).label || 'OpenCode'))

  const groups = useMemo<SelectorModelGroup[]>(
    () => groupModelsBySlashPrefix(resources?.models ?? []).map(({ group, items }) => ({
      id: group || 'other',
      name: group || 'other',
      models: items.map(({ model, label }) => ({
        id: model.id,
        name: label,
        description: model.description,
      })),
    })),
    [resources?.models],
  )

  const agentOptions = useMemo<SelectorAgentOption[]>(
    () => agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
    })),
    [agents],
  )

  const effortOptions = (current?.supportedEffortLevels ?? []).map((value) => ({
    value,
    label: EFFORT_LABELS[value],
  }))

  const selectModel = (modelId: string) => {
    const model = resources?.models.find((item) => item.id === modelId)
    const effort = resolveEffortForModel(model?.supportedEffortLevels ?? [], selectedEffort)
    setSelectedModel(modelId)
    setSelectedEffort(effort)
  }

  const selectAgent = (agentId: string) => {
    setOpenCodeAgentId(agentId)
    const agent = agents.find((item) => item.id === agentId)
    const modelId = agent?.modelId
    if (!modelId || !resources?.models.some((model) => model.id === modelId)) return
    selectModel(modelId)
  }

  if (groups.length === 0 && agentOptions.length === 0) {
    return <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">OpenCode</span>
  }

  return (
    <GroupedModelEffortSelector
      modelGroups={groups}
      selectedModelId={selectedModel}
      selectedModelLabel={modelLabel}
      onSelectModel={selectModel}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort ?? null}
      onSelectEffort={(value) => setSelectedEffort(value as EffortLevel)}
      agents={agentOptions}
      selectedAgentId={effectiveAgentId}
      selectedAgentLabel={agentLabel}
      onSelectAgent={selectAgent}
      agentsDisabled={isPlanMode}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
