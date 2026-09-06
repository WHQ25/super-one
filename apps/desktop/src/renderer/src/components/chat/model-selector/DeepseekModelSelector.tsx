import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EffortLevel } from '@superone/shared/agent-types'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { useActiveSession, useChatStore, useScopedSessionActions } from '@/stores/chat'
import {
  deepseekPresetCopy,
  deepseekPresetIcon,
  useDeepseekPresetSelection,
} from '../DeepseekPresetSelector'
import {
  GroupedModelEffortSelector,
  type SelectorEffortOption,
  type SelectorModeOption,
  type SelectorModelOption,
} from './GroupedModelEffortSelector'

const DEFAULT_MODEL = 'deepseek-v4-pro'

export function DeepseekModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()
  const resources = useChatStore((state) => state.harnessResources.dsh)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const { setSelectedModel, setSelectedEffort } = useScopedSessionActions()
  const { presets, selectedId: selectedModeId, switchable, choose } = useDeepseekPresetSelection()

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
      label: formatEffortLabel(value),
    })),
    [current],
  )

  const modes = useMemo<SelectorModeOption[]>(
    () => presets.map((preset) => {
      const copy = deepseekPresetCopy(preset, t)
      return {
        id: preset.id,
        name: copy.name,
        description: copy.description ?? undefined,
        icon: deepseekPresetIcon(preset.id),
        disabled: preset.broken !== null,
      }
    }),
    [presets, t],
  )

  const SelectedModeIcon = deepseekPresetIcon(selectedModeId)

  if (models.length === 0) {
    return (
      <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground">
        <SelectedModeIcon className="size-3.5 shrink-0" />
        DeepSeek
      </span>
    )
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
      modes={modes}
      modeLabel={t('chatDshPreset.label')}
      selectedModeId={selectedModeId}
      onSelectMode={(id) => {
        const preset = presets.find((entry) => entry.id === id)
        if (preset) void choose(preset)
      }}
      modesDisabled={!switchable}
      modesDisabledReason={t('chatDshPreset.locked')}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
