/**
 * Minimal JSON Schema → Zod shape converter for Host Action MCP registration.
 * Enough for desktop browser tool schemas (from getBrowserToolDescriptors).
 */
import { z, type ZodTypeAny } from 'zod'

function numberConstraint(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function schemaTypeToZod(type: string, prop: Record<string, unknown>): ZodTypeAny {
  switch (type) {
    case 'string': {
      const enumValues = Array.isArray(prop.enum)
        ? prop.enum.filter((value): value is string => typeof value === 'string')
        : []
      if (enumValues.length > 0) return z.enum(enumValues as [string, ...string[]])
      let field: ZodTypeAny = z.string()
      const minLength = numberConstraint(prop.minLength)
      const maxLength = numberConstraint(prop.maxLength)
      if (minLength !== undefined) field = (field as z.ZodString).min(minLength)
      if (maxLength !== undefined) field = (field as z.ZodString).max(maxLength)
      if (typeof prop.pattern === 'string') {
        field = (field as z.ZodString).regex(new RegExp(prop.pattern))
      }
      return field
    }
    case 'number':
    case 'integer': {
      let field: ZodTypeAny = type === 'integer' ? z.number().int() : z.number()
      const minimum = numberConstraint(prop.minimum)
      const maximum = numberConstraint(prop.maximum)
      if (minimum !== undefined) field = (field as z.ZodNumber).min(minimum)
      if (maximum !== undefined) field = (field as z.ZodNumber).max(maximum)
      return field
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const itemSchema =
        prop.items && typeof prop.items === 'object'
          ? jsonSchemaPropertyToZod(prop.items as Record<string, unknown>)
          : z.unknown()
      let field: ZodTypeAny = z.array(itemSchema)
      const minItems = numberConstraint(prop.minItems)
      const maxItems = numberConstraint(prop.maxItems)
      if (minItems !== undefined) field = (field as z.ZodArray<ZodTypeAny>).min(minItems)
      if (maxItems !== undefined) field = (field as z.ZodArray<ZodTypeAny>).max(maxItems)
      return field
    }
    case 'object': {
      if (!prop.properties || typeof prop.properties !== 'object') {
        return z.record(z.string(), z.unknown())
      }
      const object = z.object(jsonSchemaToZodShape(prop))
      return prop.additionalProperties === false ? object.strict() : object.passthrough()
    }
    default:
      return z.unknown()
  }
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): ZodTypeAny {
  const desc = prop.description as string | undefined
  const types = Array.isArray(prop.type)
    ? prop.type.filter((type): type is string => typeof type === 'string')
    : typeof prop.type === 'string'
      ? [prop.type]
      : []
  let field: ZodTypeAny
  if (types.length === 0) {
    field = z.unknown()
  } else if (types.length === 1) {
    field = schemaTypeToZod(types[0]!, prop)
  } else {
    const variants = types.map((type) => schemaTypeToZod(type, { ...prop, type }))
    field = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }
  if (prop.default !== undefined) {
    field = field.default(prop.default as never)
  }
  return desc ? field.describe(desc) : field
}

/**
 * Convert a JSON Schema object into a Zod raw shape for McpServer.registerTool.
 * Fields with a JSON Schema `default` are optional (default applied on parse).
 */
export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set((schema.required ?? []) as string[])
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    let field = jsonSchemaPropertyToZod(prop)
    const hasDefault = prop.default !== undefined
    // Required + no default → required. Otherwise optional (defaults already applied).
    if (!required.has(key) || hasDefault) {
      if (!hasDefault) field = field.optional()
    }
    shape[key] = field
  }
  return shape
}
