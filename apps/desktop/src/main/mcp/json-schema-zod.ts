import { z, type ZodTypeAny } from 'zod'

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): ZodTypeAny {
  const desc = prop.description as string | undefined
  const enumValues = Array.isArray(prop.enum)
    ? prop.enum.filter((v): v is string => typeof v === 'string')
    : null
  let field: ZodTypeAny
  if (prop.type === 'string' && enumValues && enumValues.length > 0) {
    field = z.enum(enumValues as [string, ...string[]])
  } else {
    switch (prop.type) {
      case 'string':
        field = z.string()
        break
      case 'number':
      case 'integer':
        field = z.number()
        break
      case 'boolean':
        field = z.boolean()
        break
      case 'array':
        field = z.array(z.unknown())
        break
      default:
        field = z.unknown()
        break
    }
  }
  return desc ? field.describe(desc) : field
}

export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const field = jsonSchemaPropertyToZod(prop)
    shape[key] = required.includes(key) ? field : field.optional()
  }
  return shape
}
