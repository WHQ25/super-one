/**
 * Node-side Claude model catalog.
 *
 * `harness.resources` is called on every remote project open, so the catalog is
 * cached: spawning the harness once per request would add seconds to session
 * startup. Empty results are never cached — a failed probe must be retried, not
 * remembered as "this node has no models".
 */

import { fetchClaudeCatalog, type ClaudeCatalogProbe } from '@superone/claude'
import type { ModelOption } from '@superone/shared/agent-types'

const CATALOG_TTL_MS = 5 * 60_000

interface CacheEntry {
  fetchedAt: number
  probe: ClaudeCatalogProbe
}

const cache = new Map<string, CacheEntry>()

export interface NodeClaudeModelCatalogOptions {
  /** Project directory the probe runs in. */
  cwd: string
  /** Harness binary; defaults to the Agent SDK bundled platform binary. */
  binaryPath?: string | null
  /** Env for the probe process (a specific Claude account's credential dir). */
  env?: Record<string, string | undefined>
  /**
   * Account intent from `claudeCatalogCacheScope` (`inherit`, `cli`, or
   * `dir:<credential dir>`). Omitted means the process login. Never a token.
   */
  accountScope?: string
  /** Injectable probe (tests). Models only; account and commands stay empty. */
  fetchModels?: (opts: { cwd: string; binaryPath?: string | null }) => Promise<ModelOption[]>
  /** Injectable full probe (tests). Wins over `fetchModels`. */
  fetchCatalog?: (opts: { cwd: string; binaryPath?: string | null; env?: Record<string, string | undefined> }) => Promise<ClaudeCatalogProbe>
  /** Injectable clock (tests). */
  now?: () => number
}

/** Models, account, slash commands and output styles from one harness probe. */
export async function getNodeClaudeCatalog(opts: NodeClaudeModelCatalogOptions): Promise<ClaudeCatalogProbe> {
  const now = opts.now ?? Date.now
  // Slash commands and output styles come from the project settings the SDK
  // loads for `cwd`. The account scope is separate from `env`: a CLI login
  // still inherits `CLAUDE_CONFIG_DIR`, so that variable cannot tell the
  // logins apart.
  const key = `${opts.binaryPath ?? 'sdk-bundled'}\0${opts.accountScope ?? 'inherit'}\0${opts.cwd}`
  const hit = cache.get(key)
  if (hit && now() - hit.fetchedAt < CATALOG_TTL_MS) return hit.probe

  const fetchCatalog = opts.fetchCatalog ?? (opts.fetchModels
    ? async (inner: { cwd: string; binaryPath?: string | null }) => ({
      models: await opts.fetchModels!(inner),
      account: {},
      slashCommands: [],
      outputStyles: [],
    })
    : fetchClaudeCatalog)
  const probe = await fetchCatalog({ cwd: opts.cwd, binaryPath: opts.binaryPath, env: opts.env })
  // An empty model list is a failed probe. Remembering it would hide a harness
  // that appears a moment later, and would also freeze an empty account.
  if (probe.models.length > 0) cache.set(key, { fetchedAt: now(), probe })
  else cache.delete(key)
  return probe
}

/** Models this node's Claude harness reports, cached per binary. */
export async function getNodeClaudeModelCatalog(
  opts: NodeClaudeModelCatalogOptions,
): Promise<ModelOption[]> {
  return (await getNodeClaudeCatalog(opts)).models
}

export function resetNodeClaudeModelCatalogForTests(): void {
  cache.clear()
}
