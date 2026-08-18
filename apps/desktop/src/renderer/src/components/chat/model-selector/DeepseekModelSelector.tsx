import { useMemo } from 'react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import {
  GroupedModelEffortSelector,
  type SelectorEffortOption,
  type SelectorModelOption,
} from './GroupedModelEffortSelector'

const DEFAULT_MODEL = 'deepseek-v4-pro'

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

export function DeepseekModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const resources = useChatStore((state) => state.harnessResources.dsh)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const setSelectedModel = useChatStore((state) => state.setSelectedModel)
  const setSelectedEffort = useChatStore((state) => state.setSelectedEffort)

  const effectiveSelectedModel = selectedModel || DEFAULT_MODEL
  const current = resources?.models.find((model) => model.id === effectiveSelectedModel)
  const modelLabel = current?.name || current?.id || effectiveSelectedModel

  const models = useMemo<SelectorModelOption[]>(
    () => (resources?.models ?? []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
    })),
    [resources?.models],
  )

  const effortOptions = useMemo<SelectorEffortOption[]>(
    () => (current?.supportedEffortLevels ?? []).map((value) => ({
      value,
      label: EFFORT_LABELS[value],
    })),
    [current],
  )

  if (models.length === 0) {
    return <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">DeepSeek</span>
  }

  return (
    <GroupedModelEffortSelector
      models={models}
      selectedModelId={effectiveSelectedModel}
      selectedModelLabel={modelLabel}
      onSelectModel={setSelectedModel}
      shouldCloseAfterModelSelect={(id) => {
        const model = resources?.models.find((entry) => entry.id === id)
        return (model?.supportedEffortLevels?.length ?? 0) <= 1
      }}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort ?? null}
      onSelectEffort={(value) => setSelectedEffort(value as EffortLevel)}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
