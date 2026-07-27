import { describe, expect, it } from 'vitest'
import { jsonSchemaToZodShape } from './json-schema-zod'

describe('jsonSchemaToZodShape', () => {
  it('maps primitive types', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        s: { type: 'string' },
        n: { type: 'number' },
        i: { type: 'integer' },
        b: { type: 'boolean' },
        a: { type: 'array' },
      },
      required: ['s', 'n', 'i', 'b', 'a'],
    })
    expect(shape.s.safeParse('x').success).toBe(true)
    expect(shape.s.safeParse(1).success).toBe(false)
    expect(shape.n.safeParse(3.14).success).toBe(true)
    expect(shape.i.safeParse(42).success).toBe(true)
    expect(shape.b.safeParse(true).success).toBe(true)
    expect(shape.a.safeParse([1, 'x']).success).toBe(true)
    expect(shape.a.safeParse('not array').success).toBe(false)
  })

  it('marks non-required fields optional', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
    })
    expect(shape.age.safeParse(undefined).success).toBe(true)
    expect(shape.name.safeParse(undefined).success).toBe(false)
  })

  it('rejects values outside string enum', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'user'] },
      },
      required: ['scope'],
    })
    expect(shape.scope.safeParse('project').success).toBe(true)
    expect(shape.scope.safeParse('user').success).toBe(true)
    expect(shape.scope.safeParse('global').success).toBe(false)
  })

  it('falls back to plain string when enum is empty or non-string', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        level: { type: 'string', enum: [] },
        weird: { type: 'string', enum: [1, 2] },
      },
      required: ['level', 'weird'],
    })
    expect(shape.level.safeParse('anything').success).toBe(true)
    expect(shape.weird.safeParse('anything').success).toBe(true)
  })

  it('preserves description on enum fields', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['a', 'b'], description: 'scope desc' },
      },
      required: ['scope'],
    })
    expect(shape.scope.description).toBe('scope desc')
  })

  it('validates nested array items and object fields', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        modules: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: { type: 'string', enum: ['diagram', 'chart'] },
        },
        request: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2 },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      required: ['modules', 'request'],
    })

    expect(shape.modules.safeParse(['diagram']).success).toBe(true)
    expect(shape.modules.safeParse(['unknown']).success).toBe(false)
    expect(shape.modules.safeParse([]).success).toBe(false)
    expect(shape.modules.safeParse(['diagram', 'chart', 'diagram']).success).toBe(false)
    expect(shape.request.safeParse({ name: 'ok' }).success).toBe(true)
    expect(shape.request.safeParse({ name: 'x' }).success).toBe(false)
    expect(shape.request.safeParse({ name: 'ok', extra: true }).success).toBe(false)
  })

  it('validates primitive unions and numeric constraints', () => {
    const shape = jsonSchemaToZodShape({
      type: 'object',
      properties: {
        value: { type: ['string', 'number', 'boolean', 'null'] },
        count: { type: 'integer', minimum: 1, maximum: 3 },
      },
      required: ['value', 'count'],
    })

    for (const value of ['x', 1, true, null]) {
      expect(shape.value.safeParse(value).success).toBe(true)
    }
    expect(shape.value.safeParse({}).success).toBe(false)
    expect(shape.count.safeParse(2).success).toBe(true)
    expect(shape.count.safeParse(2.5).success).toBe(false)
    expect(shape.count.safeParse(4).success).toBe(false)
  })
})
