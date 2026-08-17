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
  baseUrl: string // the addressable service; shared by every protocol below
  protocols: WireProtocol[] // wire formats this base speaks; each maps to a sub-path + task set
  models?: EndpointModel[] // curated list; default = platform catalog models. models[].tasks = capability narrowing knob
  defaults?: EndpointDefaults
}

export interface Plan {
  id: string // unique within the platform
  name: string
  description?: string
  auth: PlanAuth
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
  baseUrl?: string // replace
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
  overrides?: Record<string /* endpointId */, EndpointOverride>
  /**
   * Custom platforms only. When non-empty, this key's full endpoint list (baseUrl, protocols,
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
