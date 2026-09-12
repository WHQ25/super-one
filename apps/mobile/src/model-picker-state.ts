import type { HarnessId, ModelOption, ProviderModelEnv, RemoteEffortOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import { resolveClaudeDisplayName, resolveClaudeEntries } from '@superone/shared/claude-model-mapping'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { formatCodexModelName } from '@superone/shared/codex-model-label'
import { selectorCatalogParams, type SelectorCatalogParam } from '@superone/shared/model-option-params'
import { effortOptionsForModel } from './model-selection-state'
import { harnessDisplayName } from './provider-state'

/** Effort is only worth surfacing when there is more than one level to pick. */
export function hasSelectableEffort(options: RemoteEffortOption[]): boolean {
  return options.length > 1
}

/**
 * Trigger label. Under a third-party Claude mapping the slot name wins, as on
 * desktop: the catalog says `Opus 5` but the provider is serving `kimi-k2`.
 */
export function modelPickerLabel(
  harness: HarnessId,
  id: string,
  name?: string,
  modelEnv: ProviderModelEnv | null = null,
): string {
  if (harness === 'codex') return formatCodexModelName(name, id)
  if (harness === 'claude' && modelEnv) return resolveClaudeDisplayName({ id, name: name || id }, modelEnv) ?? id
  return name || id
}

export function matchesModelSearch(model: ModelOption, query: string): boolean {
  return [model.id, model.name, model.description]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query))
}

export type ModelGroup = { name: string; models: ModelOption[] }

/** The rows a Claude catalog renders as: folded onto the mapping when one is live. */
function claudeRows(models: ModelOption[], modelEnv: ProviderModelEnv | null | undefined): ModelOption[] {
  if (!modelEnv) return models
  return resolveClaudeEntries(models, modelEnv).map(({ model, displayName, description }) => ({
    ...model,
    name: displayName,
    description: description ?? '',
  }))
}

/**
 * OpenCode ids carry their own provider prefix, and an OpenCode catalog reached
 * through ACP carries it too — the desktop groups both. Every other harness
 * files its models under one heading. A mapped Claude credential collapses
 * each bucket onto the substituted model, as the desktop selector does.
 */
export function groupModels(
  models: ModelOption[],
  options: {
    harness: HarnessId
    providerName?: string
    query?: string
    acpAgentId?: string | null
    modelEnv?: ProviderModelEnv | null
  },
): ModelGroup[] {
  const query = options.query?.trim().toLowerCase() ?? ''
  const slashGrouped = options.harness === 'opencode'
    || (options.harness === 'acp' && options.acpAgentId === 'opencode')
  const groups = new Map<string, ModelOption[]>()
  const rows = options.harness === 'claude' ? claudeRows(models, options.modelEnv) : models
  for (const entry of rows) {
    const model = options.harness === 'codex'
      ? { ...entry, name: modelPickerLabel(options.harness, entry.id, entry.name) }
      : entry
    if (query && !matchesModelSearch(model, query)) continue
    const name = slashGrouped && model.id.includes('/')
      ? model.id.split('/')[0]!
      : options.providerName || harnessDisplayName(options.harness)
    const rows = groups.get(name) ?? []
    rows.push(model)
    groups.set(name, rows)
  }
  return [...groups].map(([name, rows]) => ({ name, models: rows }))
}

/**
 * The menu stays open after a model switch when the newly picked model still has
 * effort to tune — matching the desktop selector, which collapses the list back
 * onto the effort slider instead of dismissing.
 */
export function keepsOpenAfterModelSelect(
  harness: HarnessId,
  info: RemoteSystemInfo,
  modelId: string,
  providerId: string | null = null,
): boolean {
  return hasSelectableEffort(effortOptionsForModel(harness, info, modelId, providerId))
}

/**
 * Slider geometry. The track is inset by half a thumb at both ends so the thumb
 * centre lands exactly on the first and last stop, the same as the desktop range.
 */
export function effortStopOffset(index: number, count: number, width: number, thumb: number): number {
  const usable = Math.max(0, width - thumb)
  const last = count - 1
  if (last <= 0 || usable <= 0) return thumb / 2
  const clamped = Math.min(Math.max(index, 0), last)
  return (clamped / last) * usable + thumb / 2
}

/** Nearest stop for a touch at `x` within a track of `width`. */
export function effortIndexAt(x: number, count: number, width: number, thumb: number): number {
  const usable = Math.max(0, width - thumb)
  const last = count - 1
  if (last <= 0 || usable <= 0) return 0
  const ratio = (x - thumb / 2) / usable
  return Math.min(Math.max(Math.round(ratio * last), 0), last)
}

/**
 * The Options rows next to model and effort: Codex's Fast service tier and the
 * harness-native catalog params (Cursor thinking / context / optimize for).
 * The desktop derives them from the same `ModelOption` fields.
 */
export function optionParamsForModel(
  harness: HarnessId,
  model: ModelOption | undefined,
  selected: { serviceTier?: string | null; params?: Record<string, string> } = {},
): SelectorCatalogParam[] {
  if (harness === 'codex') {
    const fast = findCodexFastServiceTier(model)
    if (!fast) return []
    return [{
      id: 'fast',
      label: fast.name || 'Fast',
      kind: 'toggle',
      values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
      selected: selected.serviceTier === fast.id ? 'true' : 'false',
    }]
  }
  // Only Cursor consumes `modelParams` on the way back, so only Cursor may show
  // them. Rendering a control the send path drops is worse than hiding it.
  if (harness !== 'cursor') return []
  return selectorCatalogParams(model, selected.params ?? {})
}

/**
 * Claude's two effort easter eggs, which replace the whole trigger label:
 * `max` burns, `xhigh` goes rainbow. Only Claude has them on desktop, and only
 * when effort is a real choice.
 */
export function effortEasterEgg(
  harness: HarnessId,
  effort: string,
  efforts: RemoteEffortOption[],
): 'max' | 'xhigh' | null {
  if (harness !== 'claude' || !hasSelectableEffort(efforts)) return null
  return effort === 'max' || effort === 'xhigh' ? effort : null
}

/** Trigger summary the desktop also shows: a non-default `optimize_for` pick. */
export function optionParamSummary(params: SelectorCatalogParam[]): string[] {
  return params
    .filter((param) => param.kind === 'choice' && param.id === 'optimize_for' && param.selected !== 'balanced')
    .map((param) => param.values.find((value) => value.value === param.selected)?.label ?? param.selected)
}

export type { SelectorCatalogParam }
