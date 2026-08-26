import type { CapabilityTask, DiscoveredOpenAiModel, EffortLevel, ProviderModelEnv } from '../agent-types'
import type { WireProtocol } from './protocols'

export type PlanAuth = 'api-key' | 'oauth' | 'aws' | 'gcp'

/** A single consumer-facing capability slot. Maps 1:1 to a resolvable task. */
export type ConsumerId = 'chat:claude' | 'chat:codex' | 'media:image' | 'media:video' | 'tts' | 'asr'

export const CONSUMER_TASK: Record<ConsumerId, CapabilityTask> = {
  'chat:claude': 'chat',
  'chat:codex': 'chat',
  'media:image': 'image',
  'media:video': 'video',
  tts: 'tts',
  asr: 'asr',
}

export const CONSUMER_IDS: ConsumerId[] = ['chat:claude', 'chat:codex', 'media:image', 'media:video', 'tts', 'asr']

export interface EndpointModel {
  id: string
  name?: string
  tasks?: CapabilityTask[]
}

export interface EndpointDefaults {
  modelMapping?: ProviderModelEnv // claude-harness slot mapping (opus/sonnet/haiku/default)
  extraEnv?: Record<string, string> // harness env recommendations (API_TIMEOUT_MS, …)
}

export interface ServiceEndpoint {
  id: string // unique within the plan
  protocols: WireProtocol[] // wire formats this endpoint speaks; each maps to a route + task set
  /**
   * Host override. Absent — the normal case — means "the plan's (or credential's) base URL".
   *
   * Set this ONLY when a vendor serves one format from a genuinely different host. A different
   * *path* under the same host is a `routes` entry: that is the common case (GLM answers Claude on
   * `/api/anthropic` and OpenAI on `/api/coding/paas/v4` off one root) and modelling it as a second
   * base URL loses the fact that they share a site.
   */
  baseUrl?: string
  /**
   * Per-protocol request path, measured from the base URL's origin — the same frame relays publish
   * their own routes in (New API's `supported_endpoint[type].path`), and the same frame
   * `protocolRoute` displays. Absent means the protocol's default route.
   *
   * An override must still end with the protocol's own route segment (`PROTOCOL_ROUTE`), because
   * vendor SDKs append that themselves and we can only hand them what comes before it.
   */
  routes?: Partial<Record<WireProtocol, string>>
  models?: EndpointModel[] // curated list; default = platform catalog models. models[].tasks = capability narrowing knob
  defaults?: EndpointDefaults
  /**
   * Switched off by the user, kept only to preserve its configuration.
   *
   * Turning a protocol off must not destroy the route override, enabled models, env vars and mapping
   * that were set for it — turning it back on should restore them. So an endpoint whose protocols are
   * all deselected is archived here rather than dropped from the list. `protocols` stays intact so the
   * endpoint still reports which family it belongs to; every resolver path skips it.
   */
  disabled?: boolean
}

export interface Plan {
  id: string // unique within the platform
  name: string
  description?: string
  auth: PlanAuth
  /**
   * The site root every endpoint below hangs off — one per plan, not one per endpoint.
   *
   * Endpoints differ from each other by *route*, not by base: that is what a relay actually is, and
   * it is how relays describe themselves. Storing a base per endpoint forced the shared root to be
   * guessed back out of them with a regex, which could not survive a vendor-specific path.
   */
  baseUrl: string
  apiKeyUrl?: string // one key per plan → the "get a key" jump lives here
  catalogProviderId?: string // link into @opencode-ai/models; overrides Platform.catalogProviderId (plans may expose different models)
  endpoints: ServiceEndpoint[]
}

export interface Platform {
  id: string // 'zhipu-cn' | 'zhipu-global' | 'volcengine' | 'custom:<uuid>'
  brand: string // 'zhipu' — icon + display grouping only
  name: string // 'GLM (CN)'
  description?: string
  /** Custom platforms: site favicon as a data URL. Builtins leave this unset. */
  icon?: string
  catalogProviderId?: string // link into @opencode-ai/models
  /**
   * Custom platforms: last `/v1/models` probe result. Written at create time and replaced
   * when the user refreshes discovery. Builtins leave this unset.
   */
  discoveredModels?: DiscoveredOpenAiModel[]
  plans: Plan[]
}

export interface EndpointOverride {
  baseUrl?: string // replace — host override, same meaning as ServiceEndpoint.baseUrl
  routes?: Partial<Record<WireProtocol, string>> // per-protocol path override, merged key-level
  models?: EndpointModel[] // replace (also the entry point for user-added models)
  extraEnv?: Record<string, string> // key-level merge, user wins
  modelMapping?: ProviderModelEnv // slot-level merge
}

export interface Credential {
  id: string
  platformId: string
  planId: string
  name: string // key label, unique within platform
  secret: string // enc:v1: via crypto/secret-store; '' for oauth/aws/gcp
  secretEnv?: string // read key from env var instead
  /** Site root for this key, replacing `plan.baseUrl`. Custom platforms always set it. */
  baseUrl?: string
  overrides?: Record<string /* endpointId */, EndpointOverride>
  /**
   * Custom platforms only. When non-empty, this key's full endpoint list (protocols, routes,
   * models, defaults) replaces plan.endpoints for resolve/UI. Builtin credentials leave this unset.
   */
  endpoints?: ServiceEndpoint[]
  notes: string
  sortOrder: number
}

export interface BindingConfig {
  forcedEffort?: EffortLevel | 'auto'
  modelMapping?: ProviderModelEnv
}

export interface ConsumerBinding {
  consumer: ConsumerId
  credentialId: string
  endpointId?: string // only when the plan has >1 endpoint for the task
  config?: BindingConfig
}

export interface ResolvedService {
  platformId: string
  brand: string
  planId: string
  endpointId: string
  credentialId: string
  task: CapabilityTask
  protocol: WireProtocol
  baseUrl: string
  apiKey: string // decrypted; '' for oauth/aws/gcp
  auth: PlanAuth
  models: EndpointModel[]
  modelMapping?: ProviderModelEnv
  extraEnv?: Record<string, string>
}
