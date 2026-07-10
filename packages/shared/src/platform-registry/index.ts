import type { CapabilityTask } from '../agent-types'
import type { CatalogProvider, ModelCatalog } from '../model-catalog-types'
import { HARNESS_CHAT_PROTOCOLS, PROTOCOL_TASKS, protocolServes, type WireProtocol } from './protocols'
import type { Credential, ConsumerId, EndpointModel, EndpointOverride, Plan, Platform, ServiceEndpoint } from './types'
import { CONSUMER_TASK } from './types'

export * from './protocols'
export * from './types'
export * from './merge'
export { BUILTIN_PLATFORMS } from './builtin'

// --- lookups -----------------------------------------------------------------

export function findPlatform(platforms: Platform[], platformId: string): Platform | undefined {
  return platforms.find((p) => p.id === platformId)
}

export function findPlan(platform: Platform | undefined, planId: string): Plan | undefined {
  return platform?.plans.find((p) => p.id === planId)
}

export function findEndpoint(plan: Plan | undefined, endpointId: string): ServiceEndpoint | undefined {
  return plan?.endpoints.find((e) => e.id === endpointId)
}

/** Effective tasks an endpoint serves: its `tasks` narrowing, else the protocol's full set. */
export function endpointTasks(endpoint: ServiceEndpoint): CapabilityTask[] {
  return endpoint.tasks ?? PROTOCOL_TASKS[endpoint.protocol]
}

export function endpointServes(endpoint: ServiceEndpoint, task: CapabilityTask): boolean {
  return endpointTasks(endpoint).includes(task)
}

/**
 * Pick the endpoint that satisfies a consumer within a plan.
 * chat:claude/chat:codex additionally require a harness-compatible protocol.
 * An explicit endpointId wins when present and valid.
 */
export function selectEndpoint(
  plan: Plan,
  consumer: ConsumerId,
  endpointId?: string,
  credential?: Pick<Credential, 'overrides'>,
): ServiceEndpoint | undefined {
  const task = CONSUMER_TASK[consumer]
  const harness = consumer === 'chat:claude' ? 'claude' : consumer === 'chat:codex' ? 'codex' : undefined
  const ok = (e: ServiceEndpoint): boolean => {
    if (!endpointServes(e, task)) return false
    if (harness) return HARNESS_CHAT_PROTOCOLS[harness].includes(e.protocol)
    // Media consumers derive capability from the credential's enabled models (each tagged with the
    // tasks it serves) — a provider serves image/video/tts/asr only once such a model is enabled.
    // No credential context → protocol capability only.
    if (!credential) return true
    return (credential.overrides?.[e.id]?.models ?? []).some((m) => !m.tasks || m.tasks.includes(task))
  }
  if (endpointId) {
    const explicit = plan.endpoints.find((e) => e.id === endpointId)
    if (explicit && ok(explicit)) return explicit
  }
  return plan.endpoints.find(ok)
}

/** The models.dev catalog provider id backing a plan; plan overrides platform. */
export function catalogProviderIdFor(platform: Platform, plan?: Plan): string | undefined {
  return plan?.catalogProviderId ?? platform.catalogProviderId
}

/** Resolved model list for an endpoint: curated list, else catalog models linked via `catalogProviderId`. */
export function resolveEndpointModels(
  platform: Platform,
  plan: Plan,
  endpoint: ServiceEndpoint,
  catalog?: ModelCatalog,
): EndpointModel[] {
  if (endpoint.models) return endpoint.models
  const catalogId = catalogProviderIdFor(platform, plan)
  if (!catalogId || !catalog) return []
  const provider = catalog.providers.find((p) => p.id === catalogId)
  if (!provider) return []
  const task = endpointTasks(endpoint)
  return provider.models
    .filter((m) => task.some((t) => modelServesTask(m, t)))
    .map((m) => ({ id: m.id, name: m.name, tasks: task.filter((t) => modelServesTask(m, t)) }))
}

function modelServesTask(m: CatalogProvider['models'][number], task: CapabilityTask): boolean {
  const out = new Set(m.outputModalities)
  const inp = new Set(m.inputModalities)
  switch (task) {
    case 'chat':
      return inp.has('text') && out.has('text')
    case 'image':
      return out.has('image')
    case 'video':
      return out.has('video')
    case 'tts':
      return out.has('audio')
    case 'asr':
      return inp.has('audio') && out.has('text')
  }
}

/**
 * Seed a per-endpoint overrides map from each endpoint's builtin defaults (preset model
 * mapping + env). Used to pre-fill the advanced editor so the preset is the visible,
 * editable starting point when a credential has no overrides yet.
 */
export function defaultOverridesForPlan(plan: Plan): Record<string, EndpointOverride> {
  const out: Record<string, EndpointOverride> = {}
  for (const endpoint of plan.endpoints) {
    const d = endpoint.defaults
    if (!d) continue
    const override: EndpointOverride = {}
    if (d.modelMapping && Object.keys(d.modelMapping).length > 0) override.modelMapping = d.modelMapping
    if (d.extraEnv && Object.keys(d.extraEnv).length > 0) override.extraEnv = d.extraEnv
    if (Object.keys(override).length > 0) out[endpoint.id] = override
  }
  return out
}

// --- catalog-derived synthesis ------------------------------------------------

/**
 * Instantiate a Platform on demand from a models.dev catalog provider not covered by builtin/custom.
 * Synthesizes a single `api` plan with one `openai-chat` endpoint from the catalog api/env fields.
 */
export function synthesizePlatformFromCatalog(provider: CatalogProvider): Platform {
  return {
    id: `catalog:${provider.id}`,
    brand: provider.id,
    name: provider.name,
    catalogProviderId: provider.id,
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        apiKeyUrl: provider.doc || undefined,
        endpoints: [
          {
            id: 'openai',
            protocol: 'openai-chat',
            baseUrl: provider.api ?? '',
          },
        ],
      },
    ],
  }
}

// --- assembly ----------------------------------------------------------------

/** builtin ∪ custom (DB). Custom platforms with the same id override builtin. */
export function assembleRegistry(builtin: Platform[], custom: Platform[] = []): Platform[] {
  const byId = new Map<string, Platform>()
  for (const p of builtin) byId.set(p.id, p)
  for (const p of custom) byId.set(p.id, p)
  return [...byId.values()]
}

// --- validation (test-enforced) ----------------------------------------------

export interface RegistryValidationError {
  platformId: string
  message: string
}

export function validatePlatform(platform: Platform): RegistryValidationError[] {
  const errors: RegistryValidationError[] = []
  const err = (message: string): void => {
    errors.push({ platformId: platform.id, message })
  }
  const planIds = new Set<string>()
  for (const plan of platform.plans) {
    if (planIds.has(plan.id)) err(`duplicate plan id "${plan.id}"`)
    planIds.add(plan.id)
    const endpointIds = new Set<string>()
    for (const endpoint of plan.endpoints) {
      if (endpointIds.has(endpoint.id)) err(`plan "${plan.id}" has duplicate endpoint id "${endpoint.id}"`)
      endpointIds.add(endpoint.id)
      const allowed = PROTOCOL_TASKS[endpoint.protocol as WireProtocol]
      if (!allowed) {
        err(`endpoint "${endpoint.id}" has unknown protocol "${endpoint.protocol}"`)
        continue
      }
      for (const t of endpoint.tasks ?? []) {
        if (!protocolServes(endpoint.protocol, t)) {
          err(`endpoint "${endpoint.id}" declares task "${t}" not served by protocol "${endpoint.protocol}"`)
        }
      }
    }
  }
  return errors
}

export function validateRegistry(platforms: Platform[]): RegistryValidationError[] {
  const errors: RegistryValidationError[] = []
  const ids = new Set<string>()
  for (const p of platforms) {
    if (ids.has(p.id)) errors.push({ platformId: p.id, message: 'duplicate platform id' })
    ids.add(p.id)
    errors.push(...validatePlatform(p))
  }
  return errors
}

/** True when at least one chat endpoint in the registry is reachable by each harness consumer. */
export function everyHarnessReachable(platforms: Platform[]): boolean {
  const reachable = (harness: 'claude' | 'codex'): boolean =>
    platforms.some((p) =>
      p.plans.some((plan) =>
        plan.endpoints.some(
          (e) => endpointServes(e, 'chat') && HARNESS_CHAT_PROTOCOLS[harness].includes(e.protocol),
        ),
      ),
    )
  return reachable('claude') && reachable('codex')
}
