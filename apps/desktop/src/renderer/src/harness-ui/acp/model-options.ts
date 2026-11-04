import type { ModelOption } from '@superone/shared/agent-types'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { formatEffortOptionLabel, sortEffortsAscending } from '@superone/shared/effort-labels'
import type {
  SelectorEffortOption,
  SelectorModelGroup,
  SelectorModelOption,
} from '@/components/chat/model-selector/GroupedModelEffortSelector'
import { resolveSlashModelLabel } from '@/components/chat/ModelSelectorLists'
import { toSelectorGroups, toSelectorModels } from '../selector-models'

const ANTIGRAVITY_EFFORT_ID_RE = /^(.*)-(low|medium|high|max)$/i
const ANTIGRAVITY_EFFORT_NAME_RE = /\s*\((low|medium|high|max)\)\s*$/i

export interface AntigravityModelEffortProjection {
  models: SelectorModelOption[]
  selectedBaseModelId: string | null
  selectedModelLabel: string | null
  effortOptions: SelectorEffortOption[]
  selectedEffort: string | null
  selectedEffortLabel: string | null
  resolveModelId: (baseOrRawId: string, preferredEffort?: string | null) => string
  resolveEffortModelId: (effort: string) => string | null
}

export function splitAntigravityModelEffort(
  modelId: string,
  modelName?: string | null,
): { baseId: string; baseName: string; effort: string | null } {
  const match = ANTIGRAVITY_EFFORT_ID_RE.exec(modelId)
  if (match && match[1] && match[2]) {
    const baseId = match[1]
    const effort = match[2].toLowerCase()
    const strippedName = (modelName || modelId).replace(ANTIGRAVITY_EFFORT_NAME_RE, '').trim()
    return {
      baseId,
      baseName: strippedName || baseId,
      effort,
    }
  }
  const nameMatch = modelName ? ANTIGRAVITY_EFFORT_NAME_RE.exec(modelName) : null
  if (nameMatch && nameMatch[1]) {
    const strippedName = modelName!.replace(ANTIGRAVITY_EFFORT_NAME_RE, '').trim()
    const baseId = strippedName
      ? strippedName.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '')
      : modelId
    return {
      baseId,
      baseName: strippedName || modelId,
      effort: nameMatch[1].toLowerCase(),
    }
  }
  const rawName = (modelName || modelId).trim()
  return { baseId: modelId, baseName: rawName || modelId, effort: null }
}

export function projectAntigravityModels(
  models: ModelOption[],
  selectedModelId: string | null,
  preferredEffort?: string | null,
): AntigravityModelEffortProjection {
  const countByBase = new Map<string, Set<string>>()
  for (const model of models) {
    const { baseId, effort } = splitAntigravityModelEffort(model.id, model.name)
    if (!effort) continue
    let set = countByBase.get(baseId)
    if (!set) {
      set = new Set()
      countByBase.set(baseId, set)
    }
    set.add(effort)
  }

  const variantsByBase = new Map<string, Map<string, ModelOption>>()
  const defaultVariantByBase = new Map<string, { effort: string; modelId: string }>()
  const collapsed: SelectorModelOption[] = []

  for (const model of models) {
    const { baseId, baseName, effort } = splitAntigravityModelEffort(model.id, model.name)
    const isMultiVariant = Boolean(effort && (countByBase.get(baseId)?.size ?? 0) > 1)
    if (!isMultiVariant || !effort) {
      collapsed.push({
        id: model.id,
        name: model.name || model.id,
        ...(model.description ? { description: model.description } : {}),
      })
      continue
    }
    let variants = variantsByBase.get(baseId)
    if (!variants) {
      variants = new Map()
      variantsByBase.set(baseId, variants)
      defaultVariantByBase.set(baseId, { effort, modelId: model.id })
      const desc = model.description
        ? model.description.toLowerCase() === model.id.toLowerCase()
          ? baseId
          : model.description.replace(ANTIGRAVITY_EFFORT_ID_RE, '$1')
        : undefined
      collapsed.push({
        id: baseId,
        name: baseName,
        ...(desc ? { description: desc } : {}),
      })
    }
    variants.set(effort, model)
  }

  let selectedBaseModelId: string | null = null
  let selectedEffort: string | null = null

  if (selectedModelId) {
    const matchedRaw = models.find((m) => m.id === selectedModelId)
    const parsed = splitAntigravityModelEffort(selectedModelId, matchedRaw?.name)
    if (variantsByBase.has(parsed.baseId)) {
      selectedBaseModelId = parsed.baseId
      const variants = variantsByBase.get(parsed.baseId)!
      const fallbackEffort = defaultVariantByBase.get(parsed.baseId)?.effort ?? null
      const candidateEffort = parsed.effort ?? preferredEffort?.toLowerCase() ?? fallbackEffort
      selectedEffort =
        candidateEffort && variants.has(candidateEffort)
          ? candidateEffort
          : fallbackEffort
    } else {
      selectedBaseModelId = selectedModelId
    }
  }

  const activeVariants = selectedBaseModelId ? variantsByBase.get(selectedBaseModelId) : undefined
  const effortOptions: SelectorEffortOption[] = activeVariants
    ? sortEffortsAscending(
        [...activeVariants.keys()].map((value) => ({
          value,
          label: formatEffortOptionLabel(value),
        })),
      )
    : []

  const selectedEntry = collapsed.find((m) => m.id === selectedBaseModelId)
  const selectedModelLabel =
    selectedEntry?.name ??
    (selectedModelId ? splitAntigravityModelEffort(selectedModelId).baseName : null)
  const selectedEffortLabel = selectedEffort ? formatEffortOptionLabel(selectedEffort) : null

  const resolveModelId = (baseOrRawId: string, nextPreferredEffort?: string | null): string => {
    const variants = variantsByBase.get(baseOrRawId)
    if (!variants) return baseOrRawId
    const targetEffort = (nextPreferredEffort ?? selectedEffort)?.toLowerCase()
    if (targetEffort && variants.has(targetEffort)) {
      return variants.get(targetEffort)!.id
    }
    return defaultVariantByBase.get(baseOrRawId)?.modelId ?? [...variants.values()][0]!.id
  }

  const resolveEffortModelId = (nextEffort: string): string | null => {
    if (!selectedBaseModelId) return null
    const variants = variantsByBase.get(selectedBaseModelId)
    const key = nextEffort.trim().toLowerCase()
    if (variants?.has(key)) {
      return variants.get(key)!.id
    }
    return `${selectedBaseModelId}-${key}`
  }

  return {
    models: collapsed,
    selectedBaseModelId,
    selectedModelLabel,
    effortOptions,
    selectedEffort,
    selectedEffortLabel,
    resolveModelId,
    resolveEffortModelId,
  }
}

export function acpSelectorModels(models: ModelOption[], agentId: string | null): {
  models?: SelectorModelOption[]
  modelGroups?: SelectorModelGroup[]
  label: (model: ModelOption) => string
} {
  if (agentId === 'opencode') {
    return { modelGroups: toSelectorGroups(models), label: resolveSlashModelLabel }
  }
  if (isAntigravityAcpAgent(agentId)) {
    const projected = projectAntigravityModels(models, null)
    return {
      models: projected.models,
      label: (model) => {
        const direct = projected.models.find((m) => m.id === model.id)
        if (direct) return direct.name
        return splitAntigravityModelEffort(model.id, model.name).baseName
      },
    }
  }
  return { models: toSelectorModels(models), label: (model) => model.name || model.id }
}
