import type { ModelOption } from './agent-types'

/**
 * Harness-native catalog parameters (`ModelOption.parameters`), and how a model
 * selector projects them into an "Options" group. Cursor produces them from its
 * SDK catalog; every client — desktop selector, Remote Control mobile — renders
 * the same rows from the same rules, so the regexes below live in exactly one place.
 */

export type CatalogParam = NonNullable<ModelOption['parameters']>[number]

/** One Options row: a switch (`toggle`) or a checkable list (`choice`). */
export interface SelectorCatalogParam {
  id: string
  label: string
  kind: 'toggle' | 'choice'
  values: Array<{ value: string; label: string }>
  selected: string
}

const EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** True when a catalog parameter is the Fast toggle. */
export function isFastCatalogParam(param: Pick<CatalogParam, 'id' | 'displayName'>): boolean {
  return param.id === 'fast' || /^fast$/i.test(param.displayName ?? '')
}

/**
 * True when a catalog parameter is reasoning / effort style.
 * Note: `thinking` is a separate boolean toggle on Claude models — not effort.
 */
export function isEffortCatalogParam(param: Pick<CatalogParam, 'id' | 'displayName'>): boolean {
  if (param.id === 'thinking' || /^thinking$/i.test(param.displayName ?? '')) return false
  return /^(effort|reasoning)$/i.test(param.id)
    || /effort|reasoning/i.test(param.displayName ?? '')
}

/**
 * Pick the effort/reasoning parameter. Prefer `effort` over `reasoning` when both
 * exist (Claude models list `thinking` then `effort`; GPT lists `reasoning`).
 */
export function findEffortCatalogParam<T extends Pick<CatalogParam, 'id' | 'displayName'>>(
  parameters: T[],
): T | undefined {
  const candidates = parameters.filter(isEffortCatalogParam)
  return candidates.find((param) => param.id === 'effort')
    ?? candidates.find((param) => param.id === 'reasoning')
    ?? candidates[0]
}

/** True when a param is a boolean-ish toggle (`true`/`false` only). */
export function isToggleCatalogParam(param: Pick<CatalogParam, 'values'>): boolean {
  const values = new Set(param.values.map((value) => value.value))
  return values.size === 2 && values.has('true') && values.has('false')
}

/** Normalize catalog effort strings into SuperOne effort levels when possible. */
export function normalizeCatalogEffortValue(raw: string): NonNullable<ModelOption['supportedEffortLevels']>[number] | null {
  const value = raw.trim().toLowerCase()
  if (EFFORT_VALUES.has(value)) return value as NonNullable<ModelOption['supportedEffortLevels']>[number]
  if (value === 'extra high' || value === 'extra_high' || value === 'extra-high' || value === 'ultrathink') return 'xhigh'
  if (value === 'minimal' || value === 'min') return 'low'
  // GPT reasoning often includes "none" — not an effort level we expose.
  return null
}

/**
 * Parse a `context` parameter value into a token count.
 * Catalog values look like `200k`, `300k`, `1m`, or a plain number.
 */
export function parseCatalogContextWindow(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(raw.trim())
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]?.toLowerCase()
  return Math.round(amount * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1))
}

/** First catalog `context` value that parses to a token count (skips `auto`). */
export function firstParseableContextValue(
  values: Array<{ value: string }> | undefined,
): string | null {
  for (const item of values ?? []) {
    if (parseCatalogContextWindow(item.value) != null) return item.value
  }
  return null
}

/** Human label for a catalog param id. */
export function catalogParamLabel(param: Pick<CatalogParam, 'id' | 'displayName'>): string {
  if (param.displayName?.trim()) return param.displayName.trim()
  if (param.id === 'optimize_for') return 'Optimize for'
  if (param.id === 'context') return 'Context'
  if (param.id === 'thinking') return 'Thinking'
  if (param.id === 'fast') return 'Fast'
  if (param.id === 'effort') return 'Effort'
  if (param.id === 'reasoning') return 'Reasoning'
  return param.id.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

/** Human label for a catalog value. */
export function catalogParamValueLabel(value: string, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim()
  if (value === 'extra-high' || value === 'extra_high') return 'Extra High'
  if (value === '1m') return '1M'
  if (value === '300k') return '300K'
  if (value === '272k') return '272K'
  if (value === '200k') return '200K'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Default param map for a model catalog row.
 * Prefer balanced/medium/false when available; otherwise the first allowed value.
 */
export function defaultCatalogParams(
  model: Pick<ModelOption, 'parameters'> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const param of model?.parameters ?? []) {
    if (!param.values.length) continue
    if (param.id === 'optimize_for') {
      out[param.id] = param.values.find((value) => value.value === 'balanced')?.value ?? param.values[0]!.value
      continue
    }
    if (isEffortCatalogParam(param)) {
      out[param.id] = param.values.find((value) => normalizeCatalogEffortValue(value.value) === 'medium')?.value
        ?? param.values.find((value) => normalizeCatalogEffortValue(value.value) != null)?.value
        ?? param.values[0]!.value
      continue
    }
    if (isToggleCatalogParam(param)) {
      out[param.id] = param.values.find((value) => value.value === 'false')?.value ?? param.values[0]!.value
      continue
    }
    if (param.id === 'context') {
      out[param.id] = firstParseableContextValue(param.values) ?? param.values[0]!.value
      continue
    }
    out[param.id] = param.values[0]!.value
  }
  return out
}

/**
 * The Options rows a model selector shows next to model and effort. The effort
 * parameter is excluded: it is already the effort control, and listing it twice
 * lets the two disagree.
 */
export function selectorCatalogParams(
  model: Pick<ModelOption, 'parameters'> | null | undefined,
  selected: Record<string, string> = {},
): SelectorCatalogParam[] {
  const parameters = model?.parameters ?? []
  const effortParam = findEffortCatalogParam(parameters)
  const defaults = defaultCatalogParams(model)
  return parameters
    .filter((param) => !isEffortCatalogParam(param) && param.id !== effortParam?.id)
    .filter((param) => param.values.length > 0)
    .map((param) => ({
      id: param.id,
      label: catalogParamLabel(param),
      kind: isToggleCatalogParam(param) ? 'toggle' as const : 'choice' as const,
      values: param.values.map((value) => ({
        value: value.value,
        label: catalogParamValueLabel(value.value, value.displayName),
      })),
      selected: selected[param.id] ?? defaults[param.id] ?? param.values[0]!.value,
    }))
}
