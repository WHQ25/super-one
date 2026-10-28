import type { ModelOption } from './agent-types'
import type { SelectorCatalogParam } from './model-option-params'

type CodexTierModel = Pick<ModelOption, 'serviceTiers'> | null | undefined

export function findCodexFastServiceTier(
  model?: Pick<ModelOption, 'serviceTiers'> | null,
): NonNullable<ModelOption['serviceTiers']>[number] | undefined {
  return model?.serviceTiers?.find((tier) =>
    tier.id === 'fast'
    || tier.id === 'priority'
    || tier.name.trim().toLowerCase() === 'fast')
}

export function resolveCodexFastServiceTier(
  model: Pick<ModelOption, 'serviceTiers'> | null | undefined,
  enabled: boolean,
): string | null {
  return enabled ? (findCodexFastServiceTier(model)?.id ?? null) : null
}

/**
 * Options row for a Codex model's speed tiers.
 * Fast alone stays the On/Off toggle. Any other advertised tier (Ultrafast)
 * becomes Standard plus each catalog tier. An id the catalog does not list reads as Standard.
 */
export function codexSpeedOptionParam(
  model: CodexTierModel,
  selectedTier: string | null | undefined,
): SelectorCatalogParam | null {
  const tiers = model?.serviceTiers ?? []
  if (tiers.length === 0) return null
  const fast = findCodexFastServiceTier(model)
  if (fast && tiers.every((tier) => tier.id === fast.id)) {
    return {
      id: 'fast',
      label: fast.name || 'Fast',
      kind: 'toggle',
      values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }],
      selected: selectedTier === fast.id ? 'true' : 'false',
    }
  }
  const selected = selectedTier && tiers.some((tier) => tier.id === selectedTier) ? selectedTier : ''
  return {
    id: 'serviceTier',
    label: 'Speed',
    kind: 'choice',
    values: [
      { value: '', label: 'Standard' },
      ...tiers.map((tier) => ({ value: tier.id, label: tier.name || tier.id })),
    ],
    selected,
  }
}

/** Map a speed Options row to a catalog tier id. `undefined` means the row is not speed. */
export function codexServiceTierFromSpeedParam(
  model: CodexTierModel,
  id: string,
  value: string,
): string | null | undefined {
  if (id === 'fast') return value === 'true' ? (findCodexFastServiceTier(model)?.id ?? null) : null
  if (id !== 'serviceTier') return undefined
  if (!value) return null
  return model?.serviceTiers?.some((tier) => tier.id === value) ? value : null
}

/** Trigger mark for a speed row. Fast is the bolt alone; other speeds also show their name. */
export function codexSpeedTriggerLabel(
  params: ReadonlyArray<Pick<SelectorCatalogParam, 'id' | 'selected' | 'values'>>,
): string | null {
  if (params.some((param) => param.id === 'fast' && param.selected === 'true')) return 'Fast'
  const speed = params.find((param) => param.id === 'serviceTier')
  if (!speed?.selected) return null
  return speed.values.find((value) => value.value === speed.selected)?.label ?? speed.selected
}

/**
 * Tier a launch row should show. An explicit id wins when the model lists it.
 * `serviceTier: null` is Standard and does not revive `fastMode`.
 * Absent defers to the Fast boolean.
 */
export function codexSelectedServiceTier(
  model: CodexTierModel,
  config: { fastMode?: boolean; serviceTier?: string | null },
): string | null {
  if (typeof config.serviceTier === 'string') {
    return model?.serviceTiers?.some((tier) => tier.id === config.serviceTier) ? config.serviceTier : null
  }
  if (config.serviceTier === null) return null
  return resolveCodexFastServiceTier(model, config.fastMode === true)
}

/** Persist a speed pick. A concrete tier sets `fastMode` so older readers still enable a speed. */
export function codexSpeedSelectionPatch(tier: string | null): { fastMode: boolean; serviceTier: string | null } {
  return { fastMode: tier !== null, serviceTier: tier }
}

/**
 * Model switch: keep a tier the next model still lists. Standard stays Standard
 * when the next model has any speed. Otherwise clear, so Ultrafast does not
 * downgrade onto a Fast-only model.
 */
export function codexModelSwitchSpeedPatch(
  next: CodexTierModel,
  currentTier: string | null,
): { fastMode: false; serviceTier: null } | Record<string, never> {
  if (currentTier && next?.serviceTiers?.some((tier) => tier.id === currentTier)) return {}
  if (!currentTier && (next?.serviceTiers?.length ?? 0) > 0) return {}
  return { fastMode: false, serviceTier: null }
}
