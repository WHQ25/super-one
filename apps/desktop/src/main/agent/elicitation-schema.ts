import type { ElicitationFormField, ElicitationFormFieldType } from '@superone/shared/agent-types'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Parse an elicitation requestedSchema into generic form fields.
 * Shared by the Codex backend (mcpServer/elicitation/request notifications) and the
 * Claude backend (Options.onElicitation) — previously Codex-only in codex-turn.ts.
 */
export function parseElicitationSchema(schema: Record<string, unknown> | null): ElicitationFormField[] {
  if (!schema) return []
  const properties = asRecord(schema.properties)
  if (!properties || Object.keys(properties).length === 0) return []
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === 'string')
    : []
  const fields: ElicitationFormField[] = []
  for (const [name, raw] of Object.entries(properties)) {
    const propRec = asRecord(raw)
    if (!propRec) continue
    const t = readString(propRec.type)
    const label = readString(propRec.title) ?? name
    const description = readString(propRec.description) ?? undefined
    const isRequired = required.includes(name)
    const enumValues = Array.isArray(propRec.enum)
      ? propRec.enum.filter((v): v is string => typeof v === 'string')
      : undefined
    let fieldType: ElicitationFormFieldType | null = null
    let enumOptions: string[] | undefined
    if (enumValues && enumValues.length > 0 && t === 'string') {
      fieldType = 'enum'
      enumOptions = enumValues
    } else if (t === 'boolean') {
      fieldType = 'boolean'
    } else if (t === 'number' || t === 'integer') {
      fieldType = 'number'
    } else if (t === 'string') {
      fieldType = 'string'
    }
    if (!fieldType) continue
    fields.push({
      name,
      type: fieldType,
      label,
      ...(description ? { description } : {}),
      required: isRequired,
      ...(enumOptions ? { enumOptions } : {}),
    })
  }
  return fields
}
