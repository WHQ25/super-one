import { MODEL_BUCKETS, type ProviderModelEnv } from '../agent-types'
import type { WireProtocol } from './protocols'
import type { BindingConfig, EndpointDefaults, EndpointModel, EndpointOverride, ServiceEndpoint } from './types'

/** Key-level merge; later sources win. Undefined inputs are ignored. */
export function mergeExtraEnv(...layers: Array<Record<string, string> | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [k, v] of Object.entries(layer)) out[k] = v
  }
  return out
}

/** Slot-level merge (opus/sonnet/haiku/default/subagent independently); later sources win per slot. */
export function mergeModelMapping(...layers: Array<ProviderModelEnv | undefined>): ProviderModelEnv {
  const out: ProviderModelEnv = {}
  for (const bucket of MODEL_BUCKETS) {
    for (const layer of layers) {
      const slot = layer?.[bucket]
      if (slot?.id) out[bucket] = slot
    }
  }
  return out
}

export interface MergedEndpoint {
  /** Host override; empty means "the plan/credential site root". */
  baseUrl?: string
  /** Per-protocol route overrides, layered endpoint ← credential. */
  routes?: Partial<Record<WireProtocol, string>>
  models: EndpointModel[]
  extraEnv: Record<string, string>
  modelMapping: ProviderModelEnv
}

/**
 * Resolve an endpoint's effective config by layering:
 *   endpoint.defaults ← credential.overrides[endpointId] ← binding.config
 * baseUrl / models: whole-value replace. routes / extraEnv: key-level merge. modelMapping: slot-level.
 */
export function mergeEndpoint(
  endpoint: Pick<ServiceEndpoint, 'baseUrl' | 'routes' | 'models' | 'defaults'>,
  override?: EndpointOverride,
  bindingConfig?: BindingConfig,
): MergedEndpoint {
  const defaults: EndpointDefaults = endpoint.defaults ?? {}
  const routes = { ...endpoint.routes, ...override?.routes }
  return {
    baseUrl: override?.baseUrl ?? endpoint.baseUrl,
    routes: Object.keys(routes).length > 0 ? routes : undefined,
    models: override?.models ?? endpoint.models ?? [],
    extraEnv: mergeExtraEnv(defaults.extraEnv, override?.extraEnv),
    modelMapping: mergeModelMapping(defaults.modelMapping, override?.modelMapping, bindingConfig?.modelMapping),
  }
}
