import { claudeIdToBucket, hasOneM, type ModelBucket, type ModelOption, type ProviderModelEnv } from './agent-types'

export { claudeIdToBucket }

export interface ResolvedClaudeEntry {
  model: ModelOption
  displayName: string
  description?: string
}

/**
 * The alias a mapped bucket should hand back on select.
 *
 * A bucket collapses to a single row — `opus` and `opus[1m]` both resolve
 * through `ANTHROPIC_DEFAULT_OPUS_MODEL` and render the same slot name, so the
 * user cannot tell them apart. That row must therefore carry the plain alias:
 * under a mapping the 1M decision belongs to the slot id (the credential
 * editor's toggle stores `qwen3.8-max[1m]`), and an alias-side suffix is
 * re-attached to the substituted id — `opus[1m]` becomes `qwen3.8-max[1m]`,
 * which no provider serves.
 */
function preferredAliasByBucket(models: ModelOption[]): Map<ModelBucket, ModelOption> {
  const preferred = new Map<ModelBucket, ModelOption>()
  for (const model of models) {
    const bucket = claudeIdToBucket(model.id)
    const current = preferred.get(bucket)
    if (!current || (hasOneM(current.id) && !hasOneM(model.id))) preferred.set(bucket, model)
  }
  return preferred
}

/**
 * Fold the Claude catalog onto a third-party provider's slot mapping: each mapped
 * bucket becomes one row named after the substituted model, unmapped buckets
 * keep their catalog identity. Shared by the desktop selector and the mobile
 * picker so both show the model the provider will actually serve.
 */
export function resolveClaudeEntries(
  models: ModelOption[],
  modelEnv: ProviderModelEnv | null | undefined,
): ResolvedClaudeEntry[] {
  if (!modelEnv) {
    return models.map((model) => ({ model, displayName: model.name, description: model.description }))
  }
  const preferred = preferredAliasByBucket(models)
  const entries: ResolvedClaudeEntry[] = []
  const seenSlotIds = new Set<string>()
  for (const model of models) {
    const bucket = claudeIdToBucket(model.id)
    const slot = modelEnv[bucket]
    if (!slot?.id) {
      entries.push({ model, displayName: model.name, description: undefined })
      continue
    }
    if (seenSlotIds.has(slot.id)) continue
    seenSlotIds.add(slot.id)
    entries.push({
      model: preferred.get(bucket) ?? model,
      displayName: slot.name ?? slot.id,
      description: slot.description,
    })
  }
  return entries
}

export function resolveClaudeDisplayName(
  model: Pick<ModelOption, 'id' | 'name'> | undefined,
  modelEnv: ProviderModelEnv | null | undefined,
): string | null {
  if (!model) return null
  if (!modelEnv) return model.name ?? model.id
  const slot = modelEnv[claudeIdToBucket(model.id)]
  return slot?.name ?? slot?.id ?? model.name ?? model.id
}

/** A mapping only counts when it remaps at least one slot; an empty object is "no mapping". */
export function activeClaudeModelEnv(modelEnv: ProviderModelEnv | null | undefined): ProviderModelEnv | null {
  return modelEnv && Object.keys(modelEnv).length > 0 ? modelEnv : null
}
