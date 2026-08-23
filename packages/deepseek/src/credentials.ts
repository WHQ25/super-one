import type { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
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
    throw readOnly()
  }

  async unset(): Promise<never> {
    throw readOnly()
  }

  /**
   * The record half of the seam — `<scope>/<id>` addresses holding an api-key
   * or an authorization grant a plugin obtained for itself — has no SuperOne
   * counterpart: settings author references, not grants. Rather than open a
   * second store dsh would own, this side reports an empty, unwritable record
   * space, which is the same answer `describe`/`set` give for a reference
   * SuperOne does not hold.
   *
   * Nothing SuperOne mounts stores records (`llm-deepseek` resolves only the
   * api-key reference), so this is inert for the shipped tree. A third-party
   * plugin installed at runtime that wants to persist a grant is refused
   * explicitly rather than silently losing it on the next boot.
   */
  async readRecord(): Promise<undefined> {
    return undefined
  }

  async describeRecord(): Promise<CredentialRecordInfo> {
    return { configured: false, writable: false }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return []
  }

  async modifyRecord(): Promise<never> {
    throw readOnly()
  }

  async deleteRecord(): Promise<never> {
    throw readOnly()
  }
}

/** The one refusal every write path on this provider answers with. */
function readOnly(): Error {
  return new Error('SuperOne credentials are read-only from the harness; edit them in SuperOne settings')
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
