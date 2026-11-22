import { getCredentialDecrypted, listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'

/** Credential reference requested by the embedded DeepSeek adapter. */
export const DEEPSEEK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY'
export const SUPERONE_DSH_CREDENTIAL_PREFIX = 'SUPERONE_CRED_'

/** Encode a SuperOne credential id as a valid dsh credentialRef (`/^[A-Za-z_][A-Za-z0-9_]*$/`). */
export function dshCredentialRefForId(credentialId: string): string {
  return `${SUPERONE_DSH_CREDENTIAL_PREFIX}${Buffer.from(credentialId, 'utf8').toString('hex')}`
}

/** Resolve a credential reference for dsh (official DeepSeek key or any SuperOne credential). */
export function resolveDshCredential(ref: string): string | undefined {
  if (ref === DEEPSEEK_CREDENTIAL_REF) return resolveDeepseekApiKey()
  if (!ref.startsWith(SUPERONE_DSH_CREDENTIAL_PREFIX)) return undefined
  const hex = ref.slice(SUPERONE_DSH_CREDENTIAL_PREFIX.length)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return undefined
  const credId = Buffer.from(hex, 'hex').toString('utf8')
  const decrypted = getCredentialDecrypted(credId)
  if (!decrypted) return undefined
  if (decrypted.secret) return decrypted.secret
  if (decrypted.secretEnv) return process.env[decrypted.secretEnv] || undefined
  return undefined
}

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
