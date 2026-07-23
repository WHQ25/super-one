export const DEFAULT_CODEX_PROVIDER_CACHE_KEY = '__default__'

export function codexModelCacheKey(apiProviderId: string | null): string {
  return apiProviderId ?? DEFAULT_CODEX_PROVIDER_CACHE_KEY
}
