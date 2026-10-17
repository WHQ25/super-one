import { z, type ZodTypeAny } from 'zod'

function numberConstraint(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

type SchemaContext = { root: Record<string, unknown>; refs: Map<string, ZodTypeAny> }

function schemaTypeToZod(type: string, prop: Record<string, unknown>, context: SchemaContext): ZodTypeAny {
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
        ? jsonSchemaPropertyToZod(prop.items as Record<string, unknown>, context)
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
      const object = z.object(schemaToZodShape(prop, context))
      return prop.additionalProperties === false ? object.strict() : object.passthrough()
    }
    default:
      return z.unknown()
  }
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>, context: SchemaContext): ZodTypeAny {
  const desc = prop.description as string | undefined
  const types = Array.isArray(prop.type)
    ? prop.type.filter((type): type is string => typeof type === 'string')
    : typeof prop.type === 'string'
      ? [prop.type]
      : []
  let field: ZodTypeAny
  if (typeof prop.$ref === 'string') {
    const ref = prop.$ref
    let referenced = context.refs.get(ref)
    if (!referenced) {
      if (!ref.startsWith('#/')) throw new Error(`Unsupported JSON Schema reference: ${ref}`)
      let target: unknown = context.root
      for (const segment of ref.slice(2).split('/')) {
        const key = segment.replace(/~1/g, '/').replace(/~0/g, '~')
        target = target && typeof target === 'object' && Object.hasOwn(target, key)
          ? (target as Record<string, unknown>)[key] : undefined
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(`Unknown JSON Schema reference: ${ref}`)
      // Cache before resolving: recursive definitions reuse one lazy Zod node.
      referenced = z.lazy(() => jsonSchemaPropertyToZod(target as Record<string, unknown>, context))
      context.refs.set(ref, referenced)
    }
    field = referenced
  } else if (Array.isArray(prop.anyOf) && prop.anyOf.length > 0) {
    const variants = prop.anyOf.map(variant => jsonSchemaPropertyToZod(variant as Record<string, unknown>, context))
    field = variants.length === 1 ? variants[0] : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  } else if (types.length === 0) {
    field = z.unknown()
  } else if (types.length === 1) {
    field = schemaTypeToZod(types[0], prop, context)
  } else {
    const variants = types.map((type) => schemaTypeToZod(type, { ...prop, type }, context))
    field = z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }
  return desc ? field.describe(desc) : field
}

function schemaToZodShape(schema: Record<string, unknown>, context: SchemaContext): Record<string, ZodTypeAny> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const field = jsonSchemaPropertyToZod(prop, context)
    shape[key] = required.includes(key) ? field : field.optional()
  }
  return shape
}

export function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  return schemaToZodShape(schema, { root: schema, refs: new Map() })
}
