import { getProviderByIdRaw } from '../database'

export function resolveTestApiKey(data: { api_key?: string; provider_id?: string }): string {
  const provided = data.api_key ?? ''
  if (provided && !provided.startsWith('***')) return provided
  if (data.provider_id) {
    const stored = getProviderByIdRaw(data.provider_id)?.api_key
    if (stored) return stored
  }
  return provided
}
