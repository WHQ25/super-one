import { useEffect, useMemo } from 'react'
import type { CodexReasoningEffort } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatCodexModelName, formatReasoningEffortLabel } from '../chat-input-utils'
import { CodexModeSelector } from '../CodexModeSelector'
import {
  GroupedModelEffortSelector,
  type SelectorCatalogParam,
  type SelectorEffortOption,
  type SelectorModelOption,
} from './GroupedModelEffortSelector'
import { useSelectorProviders } from './useSelectorProviders'
import { findCodexFastServiceTier } from './codex-fast-mode'

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function CodexModelSelector({ onCloseAutoFocus }: Props) {
  const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
  const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
  const selectedCodexServiceTier = useActiveSession((s) => s.selectedCodexServiceTier)
  const codexModels = useActiveSession((s) => s.codexModels)
  const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
  const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
  const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
  const setSelectedCodexServiceTier = useChatStore((s) => s.setSelectedCodexServiceTier)
  const refreshCodexModels = useChatStore((s) => s.refreshCodexModels)
  const providerProps = useSelectorProviders('codex')

  useEffect(() => { void refreshCodexModels() }, [])

  const selectedCodexModelOption = codexModels.find((m) => m.id === selectedCodexModel)
  const currentCodexModelName = selectedCodexModelOption
    ? formatCodexModelName(selectedCodexModelOption.name, selectedCodexModelOption.id)
    : selectedCodexModel
      ? formatCodexModelName(undefined, selectedCodexModel)
      : null
  const codexReasoningEfforts = selectedCodexModelOption?.supportedReasoningEfforts ?? []
  const currentCodexReasoningEffort =
    selectedCodexReasoningEffort
    ?? selectedCodexModelOption?.defaultReasoningEffort
    ?? codexReasoningEfforts[0]?.value
    ?? null

  const models = useMemo<SelectorModelOption[]>(
    () => codexModels.map((m) => ({ id: m.id, name: formatCodexModelName(m.name, m.id), description: m.description })),
    [codexModels],
  )
  const effortOptions = useMemo<SelectorEffortOption[]>(
    () => codexReasoningEfforts.map((o) => ({ value: o.value, label: formatReasoningEffortLabel(o.value), description: o.description })),
    [codexReasoningEfforts],
  )
  const optionParams = useMemo<SelectorCatalogParam[]>(() => {
    const fastTier = findCodexFastServiceTier(selectedCodexModelOption)
    if (!fastTier) return []
    return [{
      id: 'fast',
      label: fastTier.name || 'Fast',
      kind: 'toggle',
      values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
      selected: selectedCodexServiceTier === fastTier.id ? 'true' : 'false',
    }]
  }, [selectedCodexModelOption, selectedCodexServiceTier])

  return (
    <div className="flex items-center gap-1">
      <GroupedModelEffortSelector
        models={models}
        selectedModelId={selectedCodexModel}
        selectedModelLabel={currentCodexModelName}
        onSelectModel={setSelectedCodexModel}
        shouldCloseAfterModelSelect={(id) => {
          const model = codexModels.find((entry) => entry.id === id)
          return (model?.supportedReasoningEfforts?.length ?? 0) <= 1
            && !findCodexFastServiceTier(model)
        }}
        effortOptions={effortOptions}
        selectedEffort={currentCodexReasoningEffort}
        onSelectEffort={(value) => setSelectedCodexReasoningEffort(value as CodexReasoningEffort)}
        optionParams={optionParams}
        onOptionParamChange={(id, value) => {
          if (id === 'fast') {
            setSelectedCodexServiceTier(value === 'true' ? findCodexFastServiceTier(selectedCodexModelOption)?.id ?? null : null)
          }
        }}
        onRefreshModels={() => void refreshCodexModels(true)}
        modelsLoading={codexModelsLoading}
        onCloseAutoFocus={onCloseAutoFocus}
        {...providerProps}
      />
      <CodexModeSelector />
    </div>
  )
}
