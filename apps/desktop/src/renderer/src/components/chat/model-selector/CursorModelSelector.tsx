import { useEffect, useMemo, useRef } from 'react'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
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

  const enabledModels = useMemo(
    () => filterEnabledCursorModels(resources?.models ?? [], {
      disabledModelIds: resources?.disabledModelIds,
    }),
    [resources?.models, resources?.disabledModelIds],
  )
  const current = enabledModels.find((model) => model.id === selectedModel)
    ?? resources?.models.find((model) => model.id === selectedModel)
  const modelLabel = current?.name || current?.id || (enabledModels.length ? 'Cursor' : (selectedModel || 'Cursor'))

  // Seed defaults once per model when it has catalog params but the session map
  // is empty. The seed is latched on the model id rather than on the written
  // value: a degraded catalog (params present, values missing) yields an empty
  // map, which would never satisfy a `params are non-empty` guard and would
  // re-arm this effect forever — React error #185, blank window.
  const seededModelRef = useRef<string | null>(null)
  useEffect(() => {
    if (!current?.id) return
    if (seededModelRef.current === current.id) return
    if (!current.parameters?.length) return
    if (Object.keys(cursorModelParams).length > 0) return
    seededModelRef.current = current.id
    const defaults = defaultCursorModelParams(current)
    if (Object.keys(defaults).length === 0) return
    setCursorModelParams(defaults)
  }, [current, cursorModelParams, setCursorModelParams])

  const models = useMemo<SelectorModelOption[]>(
    () => enabledModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
    })),
    [enabledModels],
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
