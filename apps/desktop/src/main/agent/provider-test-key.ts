import { getCredentialDecrypted } from '../providers/credential-store'

/** Resolve the real key for a connection test: a masked/empty value falls back to the stored credential secret. */
export function resolveTestApiKey(data: { api_key?: string; credential_id?: string }): string {
  const provided = data.api_key ?? ''
  if (provided && !provided.startsWith('***')) return provided
  if (data.credential_id) {
    const cred = getCredentialDecrypted(data.credential_id)
    if (cred) return cred.secretEnv ? (process.env[cred.secretEnv] ?? '') : cred.secret
  }
  return provided
}
