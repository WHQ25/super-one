import type { ModelListItem, ModelParameterDefinition, ModelSelection, ModelParameterValue } from '@cursor/sdk'
import type { ModelOption } from '@superone/shared/agent-types'
import {
  catalogParamLabel as cursorParamLabel,
  catalogParamValueLabel as cursorParamValueLabel,
  defaultCatalogParams as defaultCursorModelParams,
  findEffortCatalogParam as findCursorEffortParam,
  firstParseableContextValue as firstParseableCursorContextValue,
  isEffortCatalogParam as isCursorEffortParam,
  isFastCatalogParam as isCursorFastParam,
  isToggleCatalogParam as isCursorToggleParam,
  normalizeCatalogEffortValue as normalizeEffortValue,
  parseCatalogContextWindow as parseCursorContextWindow,
} from '@superone/shared/model-option-params'

type EffortLevel = NonNullable<ModelOption['supportedEffortLevels']>[number]

type CatalogParam = NonNullable<ModelOption['parameters']>[number]

// The catalog-param rules are shared with every model selector, including
// Remote Control clients, which cannot depend on this package.
export {
  cursorParamLabel,
  cursorParamValueLabel,
  defaultCursorModelParams,
  findCursorEffortParam,
  firstParseableCursorContextValue,
  isCursorEffortParam,
  isCursorFastParam,
  isCursorToggleParam,
  normalizeEffortValue,
  parseCursorContextWindow,
}

/**
 * Window for the Context ring: selected param, else first parseable catalog value.
 */
export function resolveCursorSelectedContextWindow(
  selected: string | null | undefined,
  model: Pick<ModelOption, 'parameters'> | null | undefined,
): number | null {
  const parsed = parseCursorContextWindow(selected)
  if (parsed != null) return parsed
  return parseCursorContextWindow(
    firstParseableCursorContextValue(model?.parameters?.find((param) => param.id === 'context')?.values),
  )
}

/**
 * Map Cursor SDK catalog entry → SuperOne ModelOption (effort + fast capability).
 */
export function mapCursorModel(item: ModelListItem): ModelOption {
  const parameters = item.parameters ?? []
  const effortParam = findCursorEffortParam(parameters)
  const supportedEffortLevels = effortParam?.values
    ?.map((v) => normalizeEffortValue(v.value))
    .filter((v): v is EffortLevel => v != null)
  const uniqueEfforts = supportedEffortLevels ? [...new Set(supportedEffortLevels)] : []
  const supportsFastMode = parameters.some(isCursorFastParam)

  return {
    id: item.id,
    name: item.displayName || item.id,
    description: item.description ?? '',
    supportsFastMode: supportsFastMode || undefined,
    supportsEffort: uniqueEfforts.length > 0 || undefined,
    supportedEffortLevels: uniqueEfforts.length ? uniqueEfforts : undefined,
    // Preserve raw SDK params so send can rebuild ModelSelection.params.
    parameters: parameters.length
      ? parameters.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          values: p.values.map((v) => ({ value: v.value, displayName: v.displayName })),
        }))
      : undefined,
  }
}

export interface BuildCursorModelSelectionInput {
  modelId: string
  /** Catalog row for this model (parameters / capabilities). */
  model?: Pick<ModelOption, 'parameters' | 'supportsFastMode' | 'supportedEffortLevels'> | null
  /** Selected raw param id → value map (source of truth). */
  params?: Record<string, string> | null
  /** @deprecated Prefer `params`; kept for transitional callers. */
  effort?: string | null
  /** @deprecated Prefer `params`; kept for transitional callers. */
  fast?: boolean | null
}

/**
 * Build SDK `ModelSelection` from the full selected params map.
 */
export function buildCursorModelSelection(input: BuildCursorModelSelectionInput): ModelSelection {
  const parameters = input.model?.parameters ?? []
  const selected: Record<string, string> = { ...(input.params ?? {}) }

  // Back-compat shims when callers still pass effort/fast separately.
  if (input.effort != null && !selected.effort && !selected.reasoning) {
    const effortParam = findCursorEffortParam(parameters)
    if (effortParam) {
      const match = effortParam.values.find((v) =>
        v.value === input.effort || normalizeEffortValue(v.value) === input.effort,
      )
      if (match) selected[effortParam.id] = match.value
    }
  }
  if (input.fast != null && selected.fast == null) {
    selected.fast = input.fast ? 'true' : 'false'
  }

  const params: ModelParameterValue[] = []
  for (const def of parameters) {
    const value = selected[def.id]
    if (value == null) continue
    if (!def.values.some((v) => v.value === value)) continue
    params.push({ id: def.id, value })
  }

  // Router requires an explicit optimize_for when the catalog lists it.
  const optimize = parameters.find((p) => p.id === 'optimize_for')
  if (optimize && !params.some((p) => p.id === 'optimize_for')) {
    const balanced = optimize.values.find((v) => v.value === 'balanced') ?? optimize.values[0]
    if (balanced) params.push({ id: optimize.id, value: balanced.value })
  }

  return {
    id: input.modelId,
    ...(params.length > 0 ? { params } : {}),
  }
}
