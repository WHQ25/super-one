import type { ConsumerBinding, Credential, Platform, ServiceEndpoint } from './types'

/** A credential store's full contents with plaintext secrets: provider push/pull between machines. */
export interface ProviderBundle {
  credentials: Credential[]
  bindings: ConsumerBinding[]
  customPlatforms: Platform[]
}

/** The writes a credential store offers an imported bundle. */
export interface ProviderBundleTarget {
  hasCredential(id: string): boolean
  createCredential(
    input: Pick<Credential, 'id' | 'platformId' | 'planId' | 'name'> &
      Partial<Pick<Credential, 'secret' | 'secretEnv' | 'baseUrl' | 'overrides' | 'endpoints' | 'notes'>>,
  ): unknown
  updateCredential(
    id: string,
    patch: Partial<Pick<Credential, 'name' | 'secret' | 'secretEnv' | 'baseUrl' | 'overrides' | 'notes' | 'sortOrder'>> & {
      endpoints?: ServiceEndpoint[] | null
    },
  ): unknown
  setBinding(binding: ConsumerBinding): void
  upsertCustomPlatform(def: Platform): unknown
  /** Drop every binding, custom platform and credential except those in `keep`. */
  clear(keep: ReadonlySet<string>): void
}

/**
 * Import another store's bundle. Entries replace by id; local-only ones stay
 * unless `replaceAll`. Malformed entries (the bundle arrives over RPC) are skipped.
 */
export function importProviderBundle(
  target: ProviderBundleTarget,
  bundle: Partial<ProviderBundle>,
  opts?: { replaceAll?: boolean },
): { credentials: number; bindings: number } {
  // An empty secret is one the sender could not read (e.g. its keychain failed
  // to decrypt it): the stored key for that id survives the import.
  const unread = (c: Partial<Credential> | undefined) => !!c?.id && !c.secret && target.hasCredential(c.id)
  if (opts?.replaceAll) target.clear(new Set((bundle.credentials ?? []).filter(unread).map((c) => c.id)))
  for (const plat of bundle.customPlatforms ?? []) {
    if (plat?.id) target.upsertCustomPlatform(plat)
  }
  let credentials = 0
  for (const c of bundle.credentials ?? []) {
    if (!c?.id || !c.platformId || !c.planId || !c.name) continue
    if (target.hasCredential(c.id)) {
      target.updateCredential(c.id, {
        name: c.name,
        secret: c.secret || undefined,
        secretEnv: c.secretEnv,
        baseUrl: c.baseUrl,
        overrides: c.overrides,
        endpoints: c.endpoints ?? null,
        notes: c.notes,
        sortOrder: c.sortOrder,
      })
    } else {
      target.createCredential({
        id: c.id,
        platformId: c.platformId,
        planId: c.planId,
        name: c.name,
        secret: c.secret,
        secretEnv: c.secretEnv,
        baseUrl: c.baseUrl,
        overrides: c.overrides,
        endpoints: c.endpoints,
        notes: c.notes,
      })
    }
    credentials += 1
  }
  let bindings = 0
  for (const b of bundle.bindings ?? []) {
    if (!b?.consumer || !b.credentialId) continue
    target.setBinding(b)
    bindings += 1
  }
  return { credentials, bindings }
}
