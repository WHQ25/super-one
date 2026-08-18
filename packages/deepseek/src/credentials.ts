import type { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'

/** Look up one credential reference; return undefined while unconfigured. */
export type CredentialLookup = (ref: string) => string | undefined

/**
 * Serves dsh credential references straight out of SuperOne's own credential
 * store, so no secret is exported into `process.env` and a re-bound key
 * reaches the very next request (the seam resolves per operation).
 *
 * This is why SuperOne never mounts `dsh-credentials-local`: that provider owns
 * `$DSH_HOME/.credentials.yaml`, a second store we would have to keep in sync.
 */
export interface SuperoneCredentialConfig {
  lookup: CredentialLookup
}

export class SuperoneCredentialProvider extends CredentialProvider {
  private readonly lookup: CredentialLookup

  constructor(ctx: Context, config: SuperoneCredentialConfig) {
    super(ctx)
    this.lookup = config.lookup
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.lookup(String(ref))
    // Seam-wide rule: an empty stored value is absent everywhere.
    if (!value) return undefined
    return { value, source: 'superone' }
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = this.lookup(String(ref))
    return value
      ? { configured: true, source: 'superone', writable: false }
      : { configured: false, writable: false }
  }

  // SuperOne owns credential authoring in its own settings UI; the harness
  // side is read-only so dsh can never fork the store.
  async set(): Promise<never> {
    throw new Error('SuperOne credentials are read-only from the harness; edit them in SuperOne settings')
  }

  async unset(): Promise<never> {
    throw new Error('SuperOne credentials are read-only from the harness; edit them in SuperOne settings')
  }
}

/** Cordis plugin form: mounts the provider as `ctx.credentials`. */
export function createCredentialPlugin(lookup: CredentialLookup): {
  name: string
  apply: (ctx: Context) => void
} {
  return {
    name: 'superone-credentials',
    apply(ctx: Context) {
      ctx.plugin(SuperoneCredentialProvider, { lookup })
    },
  }
}
