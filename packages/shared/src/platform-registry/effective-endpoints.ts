import { mergeEndpoint } from './merge'
import type { Credential, EndpointDefaults, EndpointOverride, Plan, Platform, ServiceEndpoint } from './types'

export function isCustomPlatformId(platformId: string): boolean {
  return platformId.startsWith('custom:')
}

export function isCustomPlatform(platform: Pick<Platform, 'id'>): boolean {
  return isCustomPlatformId(platform.id)
}

/**
 * Fold legacy per-endpoint overrides into a concrete ServiceEndpoint list
 * (used when migrating custom keys and as a fallback before endpoints_json exists).
 */
export function foldOverridesIntoEndpoints(
  endpoints: ServiceEndpoint[],
  overrides?: Record<string, EndpointOverride>,
): ServiceEndpoint[] {
  if (!overrides || Object.keys(overrides).length === 0) return endpoints
  return endpoints.map((endpoint) => {
    const ov = overrides[endpoint.id]
    if (!ov) return endpoint
    const merged = mergeEndpoint(endpoint, ov)
    const defaults: EndpointDefaults = { ...(endpoint.defaults ?? {}) }
    if (Object.keys(merged.extraEnv).length > 0) defaults.extraEnv = merged.extraEnv
    else delete defaults.extraEnv
    if (Object.keys(merged.modelMapping).length > 0) defaults.modelMapping = merged.modelMapping
    else delete defaults.modelMapping
    const next: ServiceEndpoint = {
      ...endpoint,
      baseUrl: merged.baseUrl,
    }
    if (ov.models !== undefined || endpoint.models !== undefined) {
      next.models = merged.models
    }
    if (defaults.extraEnv || defaults.modelMapping) next.defaults = defaults
    else delete next.defaults
    return next
  })
}

/**
 * Endpoints that apply for resolve/UI given a platform + plan + optional credential.
 * Custom + credential.endpoints → key-owned list.
 * Custom + no endpoints yet → plan template folded with overrides (legacy).
 * Builtin → plan.endpoints always.
 */
export function effectiveEndpoints(
  platform: Pick<Platform, 'id'>,
  plan: Plan,
  credential?: Pick<Credential, 'endpoints' | 'overrides'> | null,
): ServiceEndpoint[] {
  if (isCustomPlatform(platform)) {
    if (credential?.endpoints && credential.endpoints.length > 0) return credential.endpoints
    return foldOverridesIntoEndpoints(plan.endpoints, credential?.overrides)
  }
  return plan.endpoints
}

/** Deep-clone endpoints so keys never share mutable plan template arrays. */
export function cloneEndpoints(endpoints: ServiceEndpoint[]): ServiceEndpoint[] {
  return endpoints.map((e) => ({
    ...e,
    protocols: [...e.protocols],
    models: e.models?.map((m) => ({ ...m, tasks: m.tasks ? [...m.tasks] : undefined })),
    defaults: e.defaults
      ? {
          extraEnv: e.defaults.extraEnv ? { ...e.defaults.extraEnv } : undefined,
          modelMapping: e.defaults.modelMapping ? { ...e.defaults.modelMapping } : undefined,
        }
      : undefined,
  }))
}
