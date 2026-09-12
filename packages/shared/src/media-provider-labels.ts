import type { MediaProviderLabel } from './agent-types'

/**
 * How a generated image's `provider` param is shown: the vendor name first,
 * and — when the catalogue entry is a distinct product of that vendor — the
 * entry's own label as a badge beside it. An id the catalogue does not know
 * (a provider removed since, or a custom one on another machine) is shown as is.
 */
export function resolveMediaProviderLabel(
  providerId: string,
  providers: readonly MediaProviderLabel[],
): { name: string; badge?: string } {
  const info = providers.find((provider) => provider.id === providerId)
  if (!info) return { name: providerId }
  return info.providerLabel ? { name: info.providerLabel, badge: info.label } : { name: info.label }
}

/**
 * How a `model` param is shown. The provider the image names is consulted
 * first, because model ids are only unique within a provider; any provider
 * that knows the id is an acceptable fallback, and an unknown id is shown as is.
 */
export function resolveMediaModelLabel(
  modelId: string,
  providerId: string | undefined,
  providers: readonly MediaProviderLabel[],
): string {
  const preferred = providerId ? providers.find((provider) => provider.id === providerId)?.models : undefined
  const inPreferred = preferred?.find((model) => model.id === modelId)
  if (inPreferred) return inPreferred.label
  for (const provider of providers) {
    const match = provider.models.find((model) => model.id === modelId)
    if (match) return match.label
  }
  return modelId
}
