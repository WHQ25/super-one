/**
 * Node-side Codex model catalog.
 *
 * Remote project open (`harness.resources`) and the model-picker refresh
 * (`provider.listModels`) both ask this node. The built-in slug table is only
 * a stale fallback when `model/list` cannot be reached. Empty results are never
 * cached — a failed probe must be retried, not remembered as "no models".
 */

import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import type { CodexReasoningEffort, ModelOption, ReasoningEffortOption } from '@superone/shared/agent-types'
import type { HarnessCatalogReader } from '@superone/runtime/harness'
import { openCodexAppServer, type CodexAppServerHandle } from '@superone/codex'
import { resolveCodexBinaryPath } from './codex-turn-runner'
import { nodeCodexAccountStore } from './codex-accounts'

const CATALOG_TTL_MS = 5 * 60_000
const PAGE_LIMIT = 100
const MAX_PAGES = 20

const REASONING_EFFORTS = new Set<CodexReasoningEffort>([
  'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
])

interface CacheEntry {
  fetchedAt: number
  models: ModelOption[]
}

const cache = new Map<string, CacheEntry>()

export interface CodexCatalogAccounts {
  defaultProviderId(): string | null
  environment(providerId: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  cliOverrides(providerId: string): string[]
}

export interface NodeCodexModelCatalogOptions {
  /** ChatGPT account (`codex-account:…`) or null for the node's default login. */
  apiProviderId?: string | null
  binaryPath?: string | null
  harnesses?: HarnessCatalogReader
  /** Injectable `model/list`. Tests pass this so nothing is spawned. */
  request?: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  /** Injectable app-server launch. Defaults to {@link openCodexAppServer}. */
  open?: (opts: {
    binaryPath: string
    env?: NodeJS.ProcessEnv
    cliArgs?: string[]
  }) => Promise<Pick<CodexAppServerHandle, 'request' | 'close'>>
  /** Injectable account registry. Defaults to this node's Codex accounts. */
  accounts?: CodexCatalogAccounts
  now?: () => number
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function toReasoningEffort(value: unknown): CodexReasoningEffort | null {
  return typeof value === 'string' && REASONING_EFFORTS.has(value as CodexReasoningEffort)
    ? value as CodexReasoningEffort
    : null
}

/** One `model/list` row, in the shape the desktop picker already consumes. */
export function mapCodexModelListItem(raw: unknown): ModelOption | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.hidden === true) return null
  const model = readString(rec.model) ?? readString(rec.id)
  if (!model) return null

  const effortSource = Array.isArray(rec.supportedReasoningEfforts)
    ? rec.supportedReasoningEfforts
    : Array.isArray(rec.reasoningEffort)
      ? rec.reasoningEffort
      : []
  const supportedReasoningEfforts = effortSource.flatMap((entry): ReasoningEffortOption[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const effort = toReasoningEffort(record.reasoningEffort ?? record.effort)
    if (!effort) return []
    const description = record.description
    return [{ value: effort, description: typeof description === 'string' ? description : effort }]
  })

  const parsedTiers = Array.isArray(rec.serviceTiers)
    ? rec.serviceTiers.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const tier = entry as Record<string, unknown>
        const id = readString(tier.id)
        if (!id) return []
        return [{ id, name: readString(tier.name) ?? id, description: readString(tier.description) ?? '' }]
      })
    : []
  const serviceTiers = parsedTiers.length > 0
    ? parsedTiers
    : Array.isArray(rec.additionalSpeedTiers)
      ? rec.additionalSpeedTiers
          .filter((tier): tier is string => typeof tier === 'string' && tier.length > 0)
          .map((tier) => ({ id: tier, name: tier === 'fast' ? 'Fast' : tier, description: '' }))
      : []

  const upgrade = rec.upgradeInfo && typeof rec.upgradeInfo === 'object'
    ? rec.upgradeInfo as Record<string, unknown>
    : null
  const retirementAt = typeof upgrade?.retirementAt === 'number' && Number.isFinite(upgrade.retirementAt)
    ? upgrade.retirementAt
    : null
  const multiAgentVersion = rec.multiAgentVersion === 'disabled'
    || rec.multiAgentVersion === 'v1'
    || rec.multiAgentVersion === 'v2'
    ? rec.multiAgentVersion
    : null

  return {
    id: model,
    name: readString(rec.displayName) ?? model,
    description: typeof rec.description === 'string' ? rec.description : '',
    isDefault: rec.isDefault === true,
    supportedReasoningEfforts,
    defaultReasoningEffort: toReasoningEffort(rec.defaultReasoningEffort) ?? undefined,
    multiAgentVersion,
    retirementAt,
    serviceTiers,
    defaultServiceTier: readString(rec.defaultServiceTier),
  }
}

/** Paginate `model/list` and map it to picker rows. Does not spawn a process. */
export async function listCodexAppServerModels(
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): Promise<ModelOption[]> {
  const models: ModelOption[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request('model/list', {
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    })
    const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
    const items = Array.isArray(record.data) ? record.data : []
    for (const raw of items) {
      const mapped = mapCodexModelListItem(raw)
      if (mapped) models.push(mapped)
    }
    const next = readString(record.nextCursor)
    if (!next || next === cursor) break
    cursor = next
  }
  if (!models.some((model) => model.isDefault) && models[0]) {
    models[0] = { ...models[0], isDefault: true }
  }
  return models
}

async function probeLive(opts: NodeCodexModelCatalogOptions): Promise<ModelOption[]> {
  const binaryPath = resolveCodexBinaryPath({
    binaryPath: opts.binaryPath,
    harnesses: opts.harnesses,
  })
  if (!binaryPath) {
    console.warn(
      '[codex] model probe skipped: no Codex binary on this node ' +
        '(enable the harness or set SUPERONE_CODEX_BINARY)',
    )
    return []
  }

  const accounts = opts.accounts ?? nodeCodexAccountStore()
  let providerId = opts.apiProviderId ?? null
  if (!providerId) {
    try { providerId = accounts.defaultProviderId() } catch { providerId = null }
  }

  let env: NodeJS.ProcessEnv = { ...process.env }
  let cliArgs: string[] | undefined
  if (providerId && isCodexAccountProvider(providerId)) {
    try {
      env = accounts.environment(providerId, env)
      cliArgs = accounts.cliOverrides(providerId)
    } catch (err) {
      console.warn(
        '[codex] model probe skipped:',
        err instanceof Error ? err.message : err,
      )
      return []
    }
  }

  const open = opts.open ?? openCodexAppServer
  const client = await open({ binaryPath, env, cliArgs })
  try {
    return await listCodexAppServerModels((method, params) => client.request(method, params))
  } finally {
    await client.close().catch(() => {})
  }
}

/**
 * Models this node's Codex login reports.
 *
 * A non-account provider id is not probed: `model/list` is the ChatGPT catalog,
 * and a custom credential keeps its own model list (or the stale fallback when
 * that list is empty). Callers that already have credential models should not
 * call this.
 */
export async function getNodeCodexModelCatalog(
  opts: NodeCodexModelCatalogOptions = {},
): Promise<ModelOption[]> {
  const now = opts.now ?? Date.now
  const key = `${opts.binaryPath ?? ''}\0${opts.apiProviderId ?? ''}`
  const hit = cache.get(key)
  if (hit && now() - hit.fetchedAt < CATALOG_TTL_MS) return hit.models

  let models: ModelOption[] = []
  try {
    if (opts.apiProviderId && !isCodexAccountProvider(opts.apiProviderId)) {
      models = []
    } else if (opts.request) {
      models = await listCodexAppServerModels(opts.request)
    } else {
      models = await probeLive(opts)
    }
  } catch (err) {
    console.warn(
      '[codex] model probe failed:',
      err instanceof Error ? err.message : err,
    )
    models = []
  }
  if (models.length > 0) cache.set(key, { fetchedAt: now(), models })
  else cache.delete(key)
  return models
}

export function resetNodeCodexModelCatalogForTests(): void {
  cache.clear()
}
