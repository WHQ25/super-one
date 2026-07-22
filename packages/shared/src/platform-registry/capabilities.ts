import type { CapabilityTask } from '../agent-types'
import {
  customPlatformEndpoints,
  FAMILY_EXTRA_PROTOCOLS,
  FAMILY_TASK_PROTOCOL,
  FAMILY_TASKS,
  PROTOCOL_FAMILIES,
  PROTOCOL_FAMILY,
  type ProtocolFamily,
  type WireProtocol,
} from './protocols'
import type { Plan, ServiceEndpoint } from './types'

/**
 * A custom platform's wire selection in its serializable form: which compat families it speaks,
 * which capabilities each family exposes, and which opt-in extra wires are enabled. This is the
 * user-facing shape behind the "Formats + capabilities" checkbox group — the endpoints array is
 * derived from it, never edited directly. Arrays (not Sets) so it survives IPC/JSON round-trips.
 */
export interface PlanCapabilities {
  families: ProtocolFamily[]
  tasks: Partial<Record<ProtocolFamily, CapabilityTask[]>>
  extras: Partial<Record<ProtocolFamily, WireProtocol[]>>
}

/**
 * Recover the capability selection (and the shared base URL) from an existing plan's endpoints.
 * A task counts as selected only when its own wire protocol is present, so an endpoint speaking
 * only openai-responses recovers as Responses without spuriously checking chat/image.
 */
export function planCapabilities(plan: Plan): PlanCapabilities & { baseUrl: string } {
  const families: ProtocolFamily[] = []
  const tasks: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  const extras: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  let baseUrl = ''
  for (const endpoint of plan.endpoints) {
    const family = PROTOCOL_FAMILY[endpoint.protocols[0]]
    if (!families.includes(family)) families.push(family)
    const picked = FAMILY_TASKS[family].filter((task) => {
      const protocol = FAMILY_TASK_PROTOCOL[family][task]
      return !!protocol && endpoint.protocols.includes(protocol)
    })
    tasks[family] = [...(tasks[family] ?? []), ...picked.filter((t) => !tasks[family]?.includes(t))]
    const pickedExtras = FAMILY_EXTRA_PROTOCOLS[family].filter((p) => endpoint.protocols.includes(p))
    if (pickedExtras.length > 0) extras[family] = pickedExtras
    if (!baseUrl) baseUrl = endpoint.baseUrl
  }
  return { families: PROTOCOL_FAMILIES.filter((f) => families.includes(f)), tasks, extras, baseUrl }
}

/**
 * Collapse a capability selection into the endpoints it describes. A single-capability family
 * (anthropic → chat, newapi → video) contributes its one task implicitly, matching the dialog
 * where such a family shows no sub-picker.
 */
export function capabilityEndpoints(caps: PlanCapabilities, baseUrl: string): ServiceEndpoint[] {
  const tasksByFamily: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  const extraByFamily: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  for (const family of PROTOCOL_FAMILIES) {
    if (!caps.families.includes(family)) continue
    const all = FAMILY_TASKS[family]
    tasksByFamily[family] = all.length > 1 ? all.filter((t) => caps.tasks[family]?.includes(t)) : all
    const picked = FAMILY_EXTRA_PROTOCOLS[family].filter((p) => caps.extras[family]?.includes(p))
    if (picked.length > 0) extraByFamily[family] = picked
  }
  return customPlatformEndpoints(tasksByFamily, baseUrl, extraByFamily)
}

/** Rebuild a plan's endpoints from a capability selection, preserving each endpoint's defaults by id. */
export function applyCapabilitiesToPlan(plan: Plan, caps: PlanCapabilities, baseUrl: string): ServiceEndpoint[] {
  const prevById = new Map(plan.endpoints.map((e) => [e.id, e]))
  return capabilityEndpoints(caps, baseUrl).map((endpoint) => {
    const defaults = prevById.get(endpoint.id)?.defaults
    return defaults ? { ...endpoint, defaults } : endpoint
  })
}
