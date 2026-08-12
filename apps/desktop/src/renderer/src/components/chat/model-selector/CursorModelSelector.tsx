import { useEffect, useMemo } from 'react'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import {
  cursorParamLabel,
  cursorParamValueLabel,
  defaultCursorModelParams,
  findCursorEffortParam,
  isCursorEffortParam,
  isCursorToggleParam,
  normalizeEffortValue,
} from '@superone/cursor/cursor-model-selection'
import { useActiveSession, useChatStore } from '@/stores/chat'
import {
  GroupedModelEffortSelector,
  type SelectorCatalogParam,
  type SelectorEffortOption,
  type SelectorModelOption,
} from './GroupedModelEffortSelector'

/**
 * Whether picking this catalog model should keep the menu open so the user
 * can tune effort / Options (same contract as Codex's shouldCloseAfterModelSelect).
 */
function cursorModelHasSideOptions(model: ModelOption | undefined): boolean {
  if (!model) return false
  if ((model.supportedEffortLevels?.length ?? 0) > 1) return true
  const effortParam = findCursorEffortParam(model.parameters ?? [])
  return (model.parameters ?? []).some(
    (param) =>
      !isCursorEffortParam(param)
      && param.id !== effortParam?.id
      && param.values.length > 0,
  )
}

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

/**
 * Cursor composer model picker — flat list with effort + all catalog Options.
 */
export function CursorModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const resources = useChatStore((state) => state.harnessResources.cursor)
  const selectedModel = useActiveSession((state) => state.selectedModel)
  const selectedEffort = useActiveSession((state) => state.selectedEffort)
  const cursorModelParams = useActiveSession((state) => state.cursorModelParams)
  const setSelectedModel = useChatStore((state) => state.setSelectedModel)
  const setSelectedEffort = useChatStore((state) => state.setSelectedEffort)
  const setCursorModelParams = useChatStore((state) => state.setCursorModelParams)
  const setCursorModelParam = useChatStore((state) => state.setCursorModelParam)

  const current = resources?.models.find((model) => model.id === selectedModel)
  const modelLabel = current?.name || current?.id || (resources?.models.length ? 'Cursor' : (selectedModel || 'Cursor'))

  // Seed defaults once when the current model has catalog params but session map is empty.
  useEffect(() => {
    if (!current?.parameters?.length) return
    if (Object.keys(cursorModelParams).length > 0) return
    setCursorModelParams(defaultCursorModelParams(current))
  }, [current, cursorModelParams, setCursorModelParams])

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

  const optionParams = useMemo<SelectorCatalogParam[]>(() => {
    const parameters = current?.parameters ?? []
    const effortParam = findCursorEffortParam(parameters)
    return parameters
      .filter((param) => !isCursorEffortParam(param) && param.id !== effortParam?.id)
      .filter((param) => param.values.length > 0)
      .map((param) => {
        const selected = cursorModelParams[param.id]
          ?? defaultCursorModelParams(current)[param.id]
          ?? param.values[0]!.value
        return {
          id: param.id,
          label: cursorParamLabel(param),
          kind: isCursorToggleParam(param) ? 'toggle' as const : 'choice' as const,
          values: param.values.map((value) => ({
            value: value.value,
            label: cursorParamValueLabel(value.value, value.displayName),
          })),
          selected,
        }
      })
  }, [current, cursorModelParams])

  const selectModel = (modelId: string) => {
    setSelectedModel(modelId)
  }

  const selectEffort = (value: string) => {
    const level = normalizeEffortValue(value) ?? (value as EffortLevel)
    setSelectedEffort(level)
  }

  if (models.length === 0) {
    return <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">Cursor</span>
  }

  return (
    <GroupedModelEffortSelector
      models={models}
      selectedModelId={selectedModel}
      selectedModelLabel={modelLabel}
      onSelectModel={selectModel}
      shouldCloseAfterModelSelect={(id) => {
        const model = resources?.models.find((entry) => entry.id === id)
        return !cursorModelHasSideOptions(model)
      }}
      effortOptions={effortOptions}
      selectedEffort={selectedEffort ?? null}
      onSelectEffort={selectEffort}
      optionParams={optionParams}
      onOptionParamChange={setCursorModelParam}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
