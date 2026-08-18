import { getCredentialDecrypted, listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'

/** Credential reference requested by the embedded DeepSeek adapter. */
export const DEEPSEEK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY'

/** Resolve the newest usable DeepSeek credential without exposing it to the catalog. */
export function resolveDeepseekApiKey(): string | undefined {
  const platformIds = new Set(
    getPlatforms().filter((platform) => platform.brand === 'deepseek').map((platform) => platform.id),
  )
  for (const credential of listCredentials()) {
    if (!platformIds.has(credential.platformId)) continue
    const decrypted = getCredentialDecrypted(credential.id)
    if (decrypted?.secret) return decrypted.secret
    if (decrypted?.secretEnv) return process.env[decrypted.secretEnv] || undefined
  }
  return process.env[DEEPSEEK_CREDENTIAL_REF] || undefined
}
