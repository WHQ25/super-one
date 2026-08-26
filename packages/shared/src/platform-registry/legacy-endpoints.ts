import {
  endpointBaseUrl,
  endpointIdFor,
  familyBaseUrl,
  PROTOCOL_FAMILY,
  PROTOCOL_ROUTE,
  PROTOCOL_TASKS,
  type EndpointSlot,
  type WireProtocol,
} from './protocols'
import { relaySiteRoot } from './relay-identify'
import type { CapabilityTask } from '../agent-types'
import type { Plan, ServiceEndpoint } from './types'

/**
 * Endpoints used to each store a whole base URL. They now store a per-protocol route hanging off one
 * site root held by the plan or the key. This module converts the old shape to the new one.
 *
 * The address a legacy endpoint actually resolved to is not its stored `baseUrl` — the old resolver
 * ran it through `familyBaseUrl`, which appends the family path when the URL has no version segment.
 * A stored `https://relay.example` on an OpenAI endpoint was requested as `https://relay.example/v1`.
 * Converting against the stored value instead of the resolved one silently moves that relay, so
 * everything here targets the resolved address.
 */
export function legacyEffectiveBase(endpoint: Pick<ServiceEndpoint, 'baseUrl'>, protocol: WireProtocol): string {
  return familyBaseUrl(PROTOCOL_FAMILY[protocol], endpoint.baseUrl ?? '')
}

/** True once an endpoint is in the new shape — the marker that makes conversion idempotent. */
function isLegacyEndpoint(endpoint: ServiceEndpoint): boolean {
  return !!endpoint.baseUrl && !endpoint.routes
}

/**
 * Routes that reproduce every protocol's old resolved address from `root`, or undefined when `root`
 * is not a prefix of all of them (a different origin, or a path the site-root regex over-stripped).
 */
function routesFrom(root: string, endpoint: ServiceEndpoint): Partial<Record<WireProtocol, string>> | undefined {
  if (!root) return undefined
  const routes: Partial<Record<WireProtocol, string>> = {}
  for (const protocol of endpoint.protocols) {
    const old = legacyEffectiveBase(endpoint, protocol)
    if (!old.startsWith(root)) return undefined
    routes[protocol] = `${old.slice(root.length)}${PROTOCOL_ROUTE[protocol]}`
  }
  return routes
}

export interface RebasedEndpoints {
  siteRoot: string
  endpoints: ServiceEndpoint[]
}

/**
 * Convert a legacy endpoint list into (site root, endpoints carrying routes).
 *
 * Returns undefined when nothing is legacy, so callers can skip the write and re-runs are no-ops.
 *
 * `storedRoot` wins when present — it is the root the rest of the app will resolve against, so the
 * conversion has to be built and checked against that exact value, not against one derived here.
 * An endpoint whose old address does not hang off the chosen root keeps its own host override; that
 * is still lossless, it just means moving the site root will not move that endpoint.
 *
 * Every rewrite is verified by resolving it back through `endpointBaseUrl` and comparing to the old
 * address. A mismatch falls back to the host-override form rather than being written out.
 */
export function rebaseLegacyEndpoints(
  endpoints: ServiceEndpoint[],
  storedRoot: string | undefined,
): RebasedEndpoints | undefined {
  const legacy = endpoints.filter(isLegacyEndpoint)
  if (legacy.length === 0) return undefined

  // One target root, decided before anything is built, so construction and verification agree.
  const derived = new Set(legacy.map((e) => relaySiteRoot(e.baseUrl!)))
  const siteRoot = storedRoot?.trim() || (derived.size === 1 ? [...derived][0]! : '')

  const next = endpoints.map((endpoint) => {
    if (!isLegacyEndpoint(endpoint)) return endpoint

    const hoistedRoutes = routesFrom(siteRoot, endpoint)
    if (hoistedRoutes) {
      const hoisted: ServiceEndpoint = { ...endpoint, routes: hoistedRoutes }
      delete hoisted.baseUrl
      const exact = endpoint.protocols.every(
        (p) => endpointBaseUrl(siteRoot, hoisted, p) === legacyEffectiveBase(endpoint, p),
      )
      if (exact) return hoisted
    }

    // Keep this endpoint pinned to its own host. `familyBaseUrl` only ever appends, so its old
    // address always hangs off the stored value and this branch is always exact.
    const pinned: ServiceEndpoint = { ...endpoint, routes: routesFrom(endpoint.baseUrl!, endpoint) ?? {} }
    return pinned
  })

  return { siteRoot: siteRoot || relaySiteRoot(legacy[0]!.baseUrl!), endpoints: next }
}

/**
 * Both conversions for one endpoint list: addresses first, then slot canonicalization. Returns
 * undefined when neither applies, so a re-run writes nothing.
 */
export function modernizeEndpoints(
  endpoints: ServiceEndpoint[],
  storedRoot: string | undefined,
): { siteRoot: string; endpoints: ServiceEndpoint[]; remap: SlotRemap } | undefined {
  const rebased = rebaseLegacyEndpoints(endpoints, storedRoot)
  const split = canonicalizeEndpointSlots(rebased?.endpoints ?? endpoints)
  if (!rebased && !split) return undefined
  return {
    siteRoot: rebased?.siteRoot ?? storedRoot ?? '',
    endpoints: split?.endpoints ?? rebased!.endpoints,
    remap: split?.remap ?? {},
  }
}

/** Apply both conversions to every plan of a platform in place. Returns the merged id remap. */
export function rebaseLegacyPlans(plans: Plan[] | undefined): SlotRemap | undefined {
  let remap: SlotRemap | undefined
  for (const plan of plans ?? []) {
    const converted = modernizeEndpoints(plan.endpoints ?? [], plan.baseUrl)
    if (!converted) continue
    plan.baseUrl = converted.siteRoot
    plan.endpoints = converted.endpoints
    remap = { ...(remap ?? {}), ...converted.remap }
  }
  return remap
}

/**
 * Split an endpoint whose protocols span several slots into one endpoint per slot.
 *
 * A custom platform created before video wires had their own endpoint stored everything in one
 * family endpoint: `{ id: 'openai', protocols: ['openai-chat', 'openai-images', 'openai-video'] }`.
 * That still *resolves* — every lookup goes through `endpoint.protocols` — but it no longer
 * *rebuilds*: `applyCapabilitiesToPlan` derives `openai` + `openai-video` and matches the old
 * endpoint by id, so the video half comes back bare and the user loses its models and routes the
 * first time they save anything on the Advanced panel.
 *
 * Splitting here rather than in the every-startup protocol migration is deliberate: this runs once,
 * so it can afford to be one-to-many, and it can hand the caller the id remap that implies.
 */
export type SlotRemap = Record<string /* old endpoint id */, Partial<Record<CapabilityTask, string>>>

export function canonicalizeEndpointSlots(
  endpoints: ServiceEndpoint[],
): { endpoints: ServiceEndpoint[]; remap: SlotRemap } | undefined {
  const needsSplit = endpoints.some((e) => new Set(e.protocols.map(endpointIdFor)).size > 1)
  if (!needsSplit) return undefined

  const out: ServiceEndpoint[] = []
  const remap: SlotRemap = {}
  const taken = new Set(endpoints.map((e) => e.id))

  for (const endpoint of endpoints) {
    const slots = new Map<EndpointSlot, WireProtocol[]>()
    for (const protocol of endpoint.protocols) {
      const slot = endpointIdFor(protocol)
      slots.set(slot, [...(slots.get(slot) ?? []), protocol])
    }
    if (slots.size <= 1) {
      out.push(endpoint)
      continue
    }

    // A model whose `tasks` match no half — an empty list, or a task this endpoint never served —
    // would fall through every filter below and be deleted. It was already unreachable, but a
    // migration that removes stored config is not a migration the user can undo, so it lands on the
    // half that keeps the old id and stays visible in the editor.
    const servedByAny = new Set([...slots.values()].flat().flatMap((p) => PROTOCOL_TASKS[p]))
    const orphanModels = (endpoint.models ?? []).filter(
      (m) => m.tasks && !m.tasks.some((t) => servedByAny.has(t)),
    )
    // Endpoint ids are free-form, so the old id need not match any slot — pick the owner by slot,
    // not by id, or a `{ id: 'main' }` endpoint has no half to put these on and they vanish again.
    const orphanOwner = [...slots.keys()].find((slot) => slot === endpoint.id) ?? [...slots.keys()][0]!

    // The slot matching the old id keeps it, so overrides and bindings that already point there
    // stay valid; the others take their slot name (suffixed if a sibling endpoint already has it).
    const byTask: Partial<Record<CapabilityTask, string>> = {}
    for (const [slot, protocols] of slots) {
      const id = slot === endpoint.id ? endpoint.id : uniqueId(slot, taken)
      taken.add(id)
      const part: ServiceEndpoint = { ...endpoint, id, protocols }
      if (endpoint.routes) {
        const routes: Partial<Record<WireProtocol, string>> = {}
        for (const p of protocols) if (endpoint.routes[p]) routes[p] = endpoint.routes[p]
        if (Object.keys(routes).length > 0) part.routes = routes
        else delete part.routes
      }
      const tasks = new Set(protocols.flatMap((p) => PROTOCOL_TASKS[p]))
      // A model without `tasks` was never narrowed, so it stays available on both halves.
      if (endpoint.models) {
        const mine = endpoint.models.filter((m) => !m.tasks || m.tasks.some((t) => tasks.has(t)))
        part.models = slot === orphanOwner ? [...mine, ...orphanModels] : mine
      }
      for (const task of tasks) byTask[task] = id
      out.push(part)
    }
    remap[endpoint.id] = byTask
  }

  return { endpoints: out, remap }
}

/** A free id for a split-off slot; only collides if the plan already has an endpoint named for it. */
function uniqueId(slot: EndpointSlot, taken: Set<string>): string {
  if (!taken.has(slot)) return slot
  let n = 2
  while (taken.has(`${slot}-${n}`)) n += 1
  return `${slot}-${n}`
}
