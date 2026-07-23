import { useEffect, useMemo } from 'react'
import type { CodexReasoningEffort } from '@superone/shared/agent-types'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatCodexModelName, formatReasoningEffortLabel } from '../chat-input-utils'
import { CodexModeSelector } from '../CodexModeSelector'
import { GroupedModelEffortSelector, type SelectorEffortOption, type SelectorModelOption } from './GroupedModelEffortSelector'
import { useSelectorProviders } from './useSelectorProviders'

interface Props {
  onCloseAutoFocus?: (e: Event) => void
}

export function CodexModelSelector({ onCloseAutoFocus }: Props) {
  const selectedCodexModel = useActiveSession((s) => s.selectedCodexModel)
  const selectedCodexReasoningEffort = useActiveSession((s) => s.selectedCodexReasoningEffort)
  const codexModels = useActiveSession((s) => s.codexModels)
  const codexModelsLoading = useActiveSession((s) => s.codexModelsLoading)
  const setSelectedCodexModel = useChatStore((s) => s.setSelectedCodexModel)
  const setSelectedCodexReasoningEffort = useChatStore((s) => s.setSelectedCodexReasoningEffort)
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

  return (
    <div className="flex items-center gap-1">
      <GroupedModelEffortSelector
        models={models}
        selectedModelId={selectedCodexModel}
        selectedModelLabel={currentCodexModelName}
        onSelectModel={setSelectedCodexModel}
        effortOptions={effortOptions}
        selectedEffort={currentCodexReasoningEffort}
        onSelectEffort={(value) => setSelectedCodexReasoningEffort(value as CodexReasoningEffort)}
        onRefreshModels={() => void refreshCodexModels(true)}
        modelsLoading={codexModelsLoading}
        onCloseAutoFocus={onCloseAutoFocus}
        {...providerProps}
      />
      <CodexModeSelector />
    </div>
  )
}
