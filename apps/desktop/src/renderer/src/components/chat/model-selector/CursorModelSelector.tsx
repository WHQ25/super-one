import { useMemo } from 'react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { groupModelsBySlashPrefix, resolveSlashModelLabel, splitSlashModelId } from '../ModelSelectorLists'
import {
  GroupedModelEffortSelector,
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

export function CursorModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const resources = useChatStore((state) => state.harnessResources.cursor)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const setSelectedModel = useChatStore((state) => state.setSelectedModel)
  const setSelectedEffort = useChatStore((state) => state.setSelectedEffort)

  const current = resources?.models.find((model) => model.id === selectedModel)
  const modelLabel = current
    ? resolveSlashModelLabel(current)
    : (resources?.models.length ? 'Cursor' : (splitSlashModelId(selectedModel).label || 'Cursor'))

  const groups = useMemo<SelectorModelGroup[]>(
    () => groupModelsBySlashPrefix(resources?.models ?? []).map(({ group, items }) => ({
      id: group || 'models',
      name: group || 'Models',
      models: items.map(({ model, label }) => ({
        id: model.id,
        name: label,
        description: model.description,
      })),
    })),
    [resources?.models],
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

  if (groups.length === 0) {
    return <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">Cursor</span>
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
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
