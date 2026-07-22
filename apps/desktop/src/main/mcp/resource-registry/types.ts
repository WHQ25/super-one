import type { ConfigFieldContext, ConfigFieldType } from '@superone/shared/agent-types'

export type ResourceFieldType = ConfigFieldType

export interface ResourceFieldDef {
  key: string
  label: string
  type: ResourceFieldType
  enumValues?: readonly string[]
  required?: boolean
  /**
   * A selector addresses *where* a change lands (e.g. which endpoint an override targets) rather than
   * carrying a value of its own. Selectors are lifted into the change's ConfigFieldContext and never
   * become editable rows in the confirmation dialog.
   */
  selector?: boolean
  /** Accepted on create only — e.g. the API key minted alongside a new custom provider. */
  createOnly?: boolean
  /** Carries a credential; the confirmation dialog renders it masked. */
  secret?: boolean
  note?: string
}

export interface ResourceDef<TRecord = unknown> {
  resource: string
  label: string
  description: string
  /** Default true. Set false for resources that aren't scoped to the session's active project (e.g. AI provider credentials). */
  projectScoped?: boolean
  fields: ResourceFieldDef[]
  identifyBy: (record: TRecord) => { title: string; subtitle?: string }
  list: (projectPath: string) => TRecord[]
  toRecordSummary: (record: TRecord) => Record<string, unknown>
  /** Where the proposed change lands. Drives both the write and the labels the confirm dialog shows. */
  contextOf?: (record: TRecord | null, values: Record<string, unknown>) => ConfigFieldContext
  /** Current value of a field, including virtual ones projected out of nested structures. */
  readField?: (record: TRecord, key: string, ctx: ConfigFieldContext) => unknown
  create: (projectPath: string, values: Record<string, unknown>, ctx: ConfigFieldContext) => TRecord
  update: (id: string, values: Record<string, unknown>, ctx: ConfigFieldContext) => TRecord | undefined
  delete: (id: string) => boolean
}

export function requireString(values: Record<string, unknown>, key: string): string {
  const v = values[key]
  if (typeof v !== 'string' || v.length === 0) throw new Error(`\`${key}\` is required and must be a non-empty string`)
  return v
}

export function optionalString(values: Record<string, unknown>, key: string): string | undefined {
  const v = values[key]
  return typeof v === 'string' ? v : undefined
}

export function asRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`\`${key}\` must be an object`)
  return value as Record<string, unknown>
}

export function asArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`\`${key}\` must be an array`)
  return value
}

/**
 * Key-level merge used by every map-shaped field (env vars, model-mapping slots): the agent sends only
 * the entries it wants to change, and an explicit `null` removes one. Sending the whole map would force
 * it to re-state every unrelated entry — the exact churn the fine-grained fields exist to avoid.
 */
export function mergeMap<T>(current: Record<string, T> | undefined, patch: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key]
    else out[key] = value as T
  }
  return out
}
