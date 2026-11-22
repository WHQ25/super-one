import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EffortLevel } from '@superone/shared/agent-types'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { useHarnessCatalogRefresh } from '@/harness-ui/catalog-refresh'
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
import { useSelectorProviders } from './useSelectorProviders'

const DEFAULT_MODEL = 'deepseek-v4-pro'

export function DeepseekModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const { t } = useTranslation()
  const refresh = useHarnessCatalogRefresh('dsh', true)
  const resources = useChatStore((state) => state.harnessResources.dsh)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const { setSelectedModel, setSelectedEffort } = useScopedSessionActions()
  const { presets, selectedId: selectedModeId, switchable, choose } = useDeepseekPresetSelection()
  const providerProps = useSelectorProviders('dsh')
  const effectiveProviderId = providerProps.selectedProviderId ?? null

  useEffect(() => {
    let cancelled = false
    void window.app.connectDeepseek(false, effectiveProviderId).then((next) => {
      if (cancelled) return
      useChatStore.setState((s) => ({ harnessResources: { ...s.harnessResources, dsh: next } }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [effectiveProviderId])

  useEffect(() => {
    const list = resources?.models ?? []
    if (!selectedModel || list.length === 0) return
    if (list.some((m) => m.id === selectedModel)) return
    const next = list.find((m) => m.isDefault) ?? list[0]
    if (next) setSelectedModel(next.id)
  }, [resources?.models, selectedModel, setSelectedModel])

  const effectiveSelectedModel = (selectedModel && resources?.models.some((m) => m.id === selectedModel))
    ? selectedModel
    : (resources?.models.find((m) => m.isDefault)?.id ?? resources?.models[0]?.id ?? (selectedModel || DEFAULT_MODEL))
  const current = resources?.models.find((model) => model.id === effectiveSelectedModel)
  const modelLabel = current?.name || current?.id || (resources?.models.length ? effectiveSelectedModel : 'DeepSeek')

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

  const effectiveEffort = useMemo(() => {
    if (effortOptions.length === 0) return null
    if (selectedEffort && effortOptions.some((o) => o.value === selectedEffort)) return selectedEffort
    return (effortOptions.find((o) => o.value === 'medium') ?? effortOptions[0])?.value ?? null
  }, [effortOptions, selectedEffort])

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

  return (
    <GroupedModelEffortSelector
      models={models}
      selectedModelId={effectiveSelectedModel}
      selectedModelLabel={modelLabel}
      onSelectModel={(id) => {
        setSelectedModel(id)
        const nextModel = resources?.models.find((entry) => entry.id === id)
        const levels = nextModel?.supportedEffortLevels ?? []
        if (levels.length > 0 && (!selectedEffort || !levels.includes(selectedEffort))) {
          setSelectedEffort(levels.includes('medium') ? 'medium' : levels[0])
        }
      }}
      shouldCloseAfterModelSelect={(id) => {
        const model = resources?.models.find((entry) => entry.id === id)
        return (model?.supportedEffortLevels?.length ?? 0) <= 1
      }}
      effortOptions={effortOptions}
      selectedEffort={effectiveEffort}
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
      onRefreshModels={() => {
        void window.app.connectDeepseek(true, effectiveProviderId).then((next) => {
          useChatStore.setState((s) => ({ harnessResources: { ...s.harnessResources, dsh: next } }))
        }).catch(() => {})
      }}
      modelsLoading={refresh.modelsLoading}
      onCloseAutoFocus={onCloseAutoFocus}
      {...providerProps}
    />
  )
}
