import { useMemo } from 'react'
import type { EffortLevel } from '@superone/shared/agent-types'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { useActiveSession, useChatStore, useScopedSessionActions } from '@/stores/chat'
import { groupModelsBySlashPrefix, resolveSlashModelLabel, splitSlashModelId } from '../ModelSelectorLists'
import { useOpenCodeResourceRefresh } from '../useOpenCodeResourceRefresh'
import { openCodeSessionModels } from '@/harness-ui/opencode/session-resources'
import {
  GroupedModelEffortSelector,
  type SelectorModelGroup,
} from './GroupedModelEffortSelector'

function resolveEffortForModel(
  levels: EffortLevel[],
  preferred: EffortLevel | null | undefined,
): EffortLevel | undefined {
  if (preferred && levels.includes(preferred)) return preferred
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

export function OpenCodeModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { refresh: refreshModels, loading: modelsLoading } = useOpenCodeResourceRefresh('models')
  const resources = useChatStore((state) => state.harnessResources.opencode)
  const nativeModels = useActiveSession(openCodeSessionModels)
  const catalog = nativeModels ?? resources?.models
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const { setSelectedModel, setSelectedEffort } = useScopedSessionActions()

  const current = catalog?.find((model) => model.id === selectedModel)
  // Prefer catalog display name; if selection is not in OpenCode catalog (stale race),
  // show a neutral label instead of another harness's model id.
  const modelLabel = current
    ? resolveSlashModelLabel(current)
    : (catalog?.length ? 'OpenCode' : (splitSlashModelId(selectedModel).label || 'OpenCode'))

  const groups = useMemo<SelectorModelGroup[]>(
    () => groupModelsBySlashPrefix(catalog ?? []).map(({ group, items }) => ({
      id: group || 'other',
      name: items[0]?.model.providerName || group || 'other',
      models: items.map(({ model, label }) => ({
        id: model.id,
        name: label,
        description: model.description,
      })),
    })),
    [catalog],
  )

  const effortOptions = (current?.supportedEffortLevels ?? []).map((value) => ({
    value,
    label: formatEffortLabel(value),
  }))

  const selectModel = (modelId: string) => {
    const model = catalog?.find((item) => item.id === modelId)
    const effort = resolveEffortForModel(model?.supportedEffortLevels ?? [], selectedEffort)
    setSelectedModel(modelId)
    setSelectedEffort(effort)
  }

  return (
    <GroupedModelEffortSelector
      onRefreshModels={() => void refreshModels()}
      modelsLoading={modelsLoading}
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
