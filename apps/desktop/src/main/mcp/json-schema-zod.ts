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
      let field = z.string()
      const minLength = numberConstraint(prop.minLength)
      const maxLength = numberConstraint(prop.maxLength)
      if (minLength !== undefined) field = field.min(minLength)
      if (maxLength !== undefined) field = field.max(maxLength)
      if (typeof prop.pattern === 'string') field = field.regex(new RegExp(prop.pattern))
      return field
    }
    case 'number':
    case 'integer': {
      let field = type === 'integer' ? z.number().int() : z.number()
      const minimum = numberConstraint(prop.minimum)
      const maximum = numberConstraint(prop.maximum)
      if (minimum !== undefined) field = field.min(minimum)
      if (maximum !== undefined) field = field.max(maximum)
      return field
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const itemSchema = prop.items && typeof prop.items === 'object'
        ? jsonSchemaPropertyToZod(prop.items as Record<string, unknown>)
        : z.unknown()
      let field = z.array(itemSchema)
      const minItems = numberConstraint(prop.minItems)
      const maxItems = numberConstraint(prop.maxItems)
      if (minItems !== undefined) field = field.min(minItems)
      if (maxItems !== undefined) field = field.max(maxItems)
      if (prop.uniqueItems === true) {
        return field.refine(
          (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
          'Array items must be unique',
        )
      }
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
    field = schemaTypeToZod(types[0], prop)
  } else {
    const variants = types.map((type) => schemaTypeToZod(type, { ...prop, type }))
    field = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
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
