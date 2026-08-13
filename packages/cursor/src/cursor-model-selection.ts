import type { ModelListItem, ModelParameterDefinition, ModelSelection, ModelParameterValue } from '@cursor/sdk'
import type { ModelOption } from '@superone/shared/agent-types'

const EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

type EffortLevel = NonNullable<ModelOption['supportedEffortLevels']>[number]

type CatalogParam = NonNullable<ModelOption['parameters']>[number]

/** True when a catalog parameter is the Fast toggle. */
export function isCursorFastParam(param: Pick<ModelParameterDefinition, 'id' | 'displayName'>): boolean {
  return param.id === 'fast' || /^fast$/i.test(param.displayName ?? '')
}

/**
 * True when a catalog parameter is reasoning / effort style.
 * Note: `thinking` is a separate boolean toggle on Claude models — not effort.
 */
export function isCursorEffortParam(param: Pick<ModelParameterDefinition, 'id' | 'displayName'>): boolean {
  if (param.id === 'thinking' || /^thinking$/i.test(param.displayName ?? '')) return false
  return /^(effort|reasoning)$/i.test(param.id)
    || /effort|reasoning/i.test(param.displayName ?? '')
}

/**
 * Pick the effort/reasoning parameter. Prefer `effort` over `reasoning` when both exist
 * (Claude models list `thinking` then `effort`; GPT lists `reasoning`).
 */
export function findCursorEffortParam(
  parameters: Array<Pick<ModelParameterDefinition, 'id' | 'displayName' | 'values'>>,
): Pick<ModelParameterDefinition, 'id' | 'displayName' | 'values'> | undefined {
  const candidates = parameters.filter(isCursorEffortParam)
  return candidates.find((p) => p.id === 'effort')
    ?? candidates.find((p) => p.id === 'reasoning')
    ?? candidates[0]
}

/** True when a param is a boolean-ish toggle (`true`/`false` only). */
export function isCursorToggleParam(param: Pick<CatalogParam, 'values'>): boolean {
  const vals = new Set(param.values.map((v) => v.value))
  return vals.size === 2 && vals.has('true') && vals.has('false')
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

/** Normalize catalog effort strings into SuperOne effort levels when possible. */
export function normalizeEffortValue(raw: string): EffortLevel | null {
  const v = raw.trim().toLowerCase()
  if (EFFORT_VALUES.has(v)) return v as EffortLevel
  if (v === 'extra high' || v === 'extra_high' || v === 'extra-high' || v === 'ultrathink') return 'xhigh'
  if (v === 'minimal' || v === 'min') return 'low'
  // GPT reasoning often includes "none" — not an effort level we expose.
  return null
}

/**
 * Parse a Cursor `context` parameter value into a token count.
 * Catalog values look like `200k`, `300k`, `1m`, or a plain number.
 */
export function parseCursorContextWindow(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(raw.trim())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]?.toLowerCase()
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  return Math.round(amount * multiplier)
}

/**
 * First catalog `context` value that parses to a token count (skips `auto`).
 */
export function firstParseableCursorContextValue(
  values: Array<{ value: string }> | undefined,
): string | null {
  for (const item of values ?? []) {
    if (parseCursorContextWindow(item.value) != null) return item.value
  }
  return null
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
  const fallback = firstParseableCursorContextValue(
    model?.parameters?.find((param) => param.id === 'context')?.values,
  )
  return parseCursorContextWindow(fallback)
}

/** Human label for a catalog param id. */
export function cursorParamLabel(param: Pick<CatalogParam, 'id' | 'displayName'>): string {
  if (param.displayName?.trim()) return param.displayName.trim()
  if (param.id === 'optimize_for') return 'Optimize for'
  if (param.id === 'context') return 'Context'
  if (param.id === 'thinking') return 'Thinking'
  if (param.id === 'fast') return 'Fast'
  if (param.id === 'effort') return 'Effort'
  if (param.id === 'reasoning') return 'Reasoning'
  return param.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Human label for a catalog value. */
export function cursorParamValueLabel(value: string, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim()
  if (value === 'extra-high' || value === 'extra_high') return 'Extra High'
  if (value === '1m') return '1M'
  if (value === '300k') return '300K'
  if (value === '272k') return '272K'
  if (value === '200k') return '200K'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Default param map for a model catalog row.
 * Prefer balanced/medium/false when available; otherwise first allowed value.
 */
export function defaultCursorModelParams(
  model: Pick<ModelOption, 'parameters'> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const param of model?.parameters ?? []) {
    if (!param.values.length) continue
    if (param.id === 'optimize_for') {
      out[param.id] = param.values.find((v) => v.value === 'balanced')?.value
        ?? param.values[0]!.value
      continue
    }
    if (isCursorEffortParam(param)) {
      const medium = param.values.find((v) => normalizeEffortValue(v.value) === 'medium')
      out[param.id] = medium?.value
        ?? param.values.find((v) => normalizeEffortValue(v.value) != null)?.value
        ?? param.values[0]!.value
      continue
    }
    if (isCursorToggleParam(param)) {
      out[param.id] = param.values.find((v) => v.value === 'false')?.value ?? param.values[0]!.value
      continue
    }
    if (param.id === 'context') {
      out[param.id] = firstParseableCursorContextValue(param.values) ?? param.values[0]!.value
      continue
    }
    out[param.id] = param.values[0]!.value
  }
  return out
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
