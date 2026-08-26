import { customEndpointsFor, endpointRoute, PROTOCOL_ORDER, protocolRoute, type WireProtocol } from './protocols'
import { withCustomAnthropicDefaults } from './effective-endpoints'
import type { Plan, ServiceEndpoint } from './types'

/**
 * A custom platform's wire selection in its serializable form: the protocols it speaks, and nothing
 * else. Endpoints are derived from this, never edited directly.
 *
 * Capabilities are deliberately absent — `PROTOCOL_TASKS` already states what each protocol serves,
 * so asking the user for both means storing one fact twice and letting the two disagree. Which
 * models are enabled for which task stays a per-model concern (`EndpointModel.tasks`).
 */
export interface PlanCapabilities {
  protocols: WireProtocol[]
}

/** Recover the protocol selection from an existing plan's endpoints. */
export function planCapabilities(plan: Plan): PlanCapabilities {
  const protocols = new Set<WireProtocol>()
  for (const endpoint of plan.endpoints) {
    if (endpoint.disabled) continue
    for (const protocol of endpoint.protocols) protocols.add(protocol)
  }
  return { protocols: PROTOCOL_ORDER.filter((p) => protocols.has(p)) }
}

/** Collapse a protocol selection into the endpoints it describes. */
export function capabilityEndpoints(caps: PlanCapabilities): ServiceEndpoint[] {
  return withCustomAnthropicDefaults(customEndpointsFor(caps.protocols))
}

/**
 * Rebuild a plan's endpoints from a protocol selection, preserving each endpoint's defaults, models,
 * and any hand-edited route or host.
 */
export function applyCapabilitiesToPlan(plan: Plan, caps: PlanCapabilities): ServiceEndpoint[] {
  const prevById = new Map(plan.endpoints.map((e) => [e.id, e]))
  const live = capabilityEndpoints(caps).map((endpoint) => {
    const prev = prevById.get(endpoint.id)
    if (!prev) return endpoint
    const next = { ...endpoint }
    if (prev.baseUrl) next.baseUrl = prev.baseUrl
    if (prev.routes) next.routes = prev.routes
    if (prev.defaults) next.defaults = prev.defaults
    if (prev.models) next.models = prev.models
    return next
  })
  // An endpoint the selection no longer derives is archived, not deleted, so switching its protocol
  // back on restores the models / env / mapping / routes configured for it. Only endpoints that
  // actually carry configuration are kept — archiving bare ones would grow the list forever.
  const liveIds = new Set(live.map((e) => e.id))
  const archived = plan.endpoints
    .filter((e) => !liveIds.has(e.id) && endpointHasConfig(e))
    .map((e) => ({ ...e, disabled: true as const }))
  return [...live, ...archived]
}

/** Whether an endpoint holds anything a user would be upset to lose: models, defaults, or a moved URL. */
export function endpointHasConfig(endpoint: ServiceEndpoint): boolean {
  if (endpoint.models?.length) return true
  if (endpoint.defaults?.modelMapping && Object.keys(endpoint.defaults.modelMapping).length > 0) return true
  if (endpoint.defaults?.extraEnv && Object.keys(endpoint.defaults.extraEnv).length > 0) return true
  if (endpoint.baseUrl) return true
  return endpoint.protocols.some((p) => endpointRoute(endpoint, p) !== protocolRoute(p))
}

/**
 * Replace one protocol's route on one endpoint — the escape hatch for a vendor that answers a format
 * somewhere other than its standard path (GLM's `/api/anthropic/v1/messages`).
 *
 * Passing the default route clears the override rather than storing a copy of it, so a plan only ever
 * carries the routes that actually differ.
 */
export function overrideEndpointRoute(
  endpoints: ServiceEndpoint[],
  endpointId: string,
  protocol: WireProtocol,
  route: string,
): ServiceEndpoint[] {
  return endpoints.map((e) => {
    if (e.id !== endpointId) return e
    const routes = { ...e.routes }
    const trimmed = route.trim()
    if (!trimmed || trimmed === protocolRoute(protocol)) delete routes[protocol]
    else routes[protocol] = trimmed
    const next = { ...e }
    if (Object.keys(routes).length > 0) next.routes = routes
    else delete next.routes
    return next
  })
}

/** Replace one endpoint's host — for a vendor serving a format from a different origin entirely. */
export function overrideEndpointBaseUrl(
  endpoints: ServiceEndpoint[],
  endpointId: string,
  baseUrl: string,
): ServiceEndpoint[] {
  return endpoints.map((e) => {
    if (e.id !== endpointId) return e
    const next = { ...e }
    if (baseUrl.trim()) next.baseUrl = baseUrl.trim()
    else delete next.baseUrl
    return next
  })
}
