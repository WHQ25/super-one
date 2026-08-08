import type { CatalogModel } from '@superone/shared/model-catalog-types'
import { normalizeModelId } from '@superone/shared/platform-registry'
import { stripOneM } from '@/lib/model-id'

export type UsageHarness = 'claude' | 'codex' | 'grok'

export interface UsageModelPresentation {
  displayName: string
  providerBrand: string
}

export function usageModelId(modelId: string): string {
  return stripOneM(modelId)
}

export function buildUsageModelNameIndex(
  models: Iterable<{ id: string; name: string }>,
): Map<string, string> {
  const index = new Map<string, string>()
  for (const model of models) {
    const name = model.name.trim()
    if (name) index.set(normalizeModelId(usageModelId(model.id)), name)
  }
  return index
}

const DEFAULT_PROVIDER_BRAND: Record<UsageHarness, string> = {
  claude: 'anthropic',
  codex: 'openai',
  grok: 'xai',
}

export function resolveUsageModelPresentation(
  modelId: string,
  harness: UsageHarness,
  catalogModels: ReadonlyMap<string, CatalogModel>,
  knownModelNames?: ReadonlyMap<string, string>,
): UsageModelPresentation {
  const baseModelId = usageModelId(modelId)
  const normalizedId = normalizeModelId(baseModelId)
  const catalogModel = catalogModels.get(normalizedId)
  return {
    displayName: catalogModel?.name ?? knownModelNames?.get(normalizedId) ?? baseModelId,
    providerBrand: catalogModel?.providerId ?? DEFAULT_PROVIDER_BRAND[harness],
  }
}
