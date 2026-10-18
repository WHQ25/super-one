import type { ConfigFieldContext } from '@superone/shared/agent-types'
import { credentialResourceDef } from './credential'
import { customPlatformResourceDef } from './custom-platform'
import type { ResourceDef } from './types'
import { settingsResources } from './settings'
import type { ConfigResourceServices } from '../config-resource-services'

export * from './types'

export const RESOURCE_DEFS: ResourceDef[] = [
  credentialResourceDef as ResourceDef,
  customPlatformResourceDef as ResourceDef,
]

export function findResourceDef(resource: string, services?: ConfigResourceServices): ResourceDef | null {
  return [...RESOURCE_DEFS, ...settingsResources(services)].find((r) => r.resource === resource) ?? null
}

export function listResourceSummaries(services?: ConfigResourceServices): Array<{ domain: string; label: string; description: string; fieldCount: number }> {
  return [...RESOURCE_DEFS, ...settingsResources(services)].map((r) => ({ domain: r.resource, label: r.label, description: r.description, fieldCount: r.fields.length }))
}

export function resourceContext(def: ResourceDef, record: unknown, values: Record<string, unknown>): ConfigFieldContext {
  return def.contextOf?.(record ?? null, values) ?? {}
}

export function readResourceField(def: ResourceDef, record: unknown, key: string, ctx: ConfigFieldContext): unknown {
  if (def.readField) return def.readField(record, key, ctx)
  return (record as Record<string, unknown> | null)?.[key]
}
