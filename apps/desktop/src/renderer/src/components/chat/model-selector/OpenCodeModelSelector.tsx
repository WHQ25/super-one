import { useMemo } from 'react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { groupModelsBySlashPrefix, resolveSlashModelLabel, splitSlashModelId } from '../ModelSelectorLists'
import { GroupedModelEffortSelector, type SelectorModelGroup } from './GroupedModelEffortSelector'
import type { EffortLevel } from '@superone/shared/agent-types'

const EFFORT_LABELS: Record<EffortLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' }

export function OpenCodeModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const resources = useChatStore((state) => state.harnessResources.opencode)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const setSelectedModel = useChatStore((state) => state.setSelectedModel)
  const setSelectedEffort = useChatStore((state) => state.setSelectedEffort)
  const current = resources?.models.find((model) => model.id === selectedModel)
  const label = current ? resolveSlashModelLabel(current) : splitSlashModelId(selectedModel).label || 'OpenCode'
  const groups = useMemo<SelectorModelGroup[]>(() => groupModelsBySlashPrefix(resources?.models ?? []).map(({ group, items }) => ({
    id: group || 'other',
    name: group || 'other',
    models: items.map(({ model, label: modelLabel }) => ({ id: model.id, name: modelLabel, description: model.description })),
  })), [resources?.models])
  const effortOptions = (current?.supportedEffortLevels ?? []).map((value) => ({ value, label: EFFORT_LABELS[value] }))
  const selectModel = (modelId: string) => {
    const model = resources?.models.find((item) => item.id === modelId)
    const levels = model?.supportedEffortLevels ?? []
    const effort = selectedEffort && levels.includes(selectedEffort)
      ? selectedEffort
      : levels.includes('medium') ? 'medium' : levels[0]
    setSelectedModel(modelId)
    setSelectedEffort(effort)
  }

  if (groups.length === 0) return <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">OpenCode</span>

  return (
    <GroupedModelEffortSelector
      modelGroups={groups}
      selectedModelId={selectedModel}
      selectedModelLabel={label}
      onSelectModel={selectModel}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort ?? null}
      onSelectEffort={(value) => setSelectedEffort(value as EffortLevel)}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
