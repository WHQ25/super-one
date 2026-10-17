import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToZodShape } from './json-schema-zod'

describe('jsonSchemaToZodShape', () => {
  it('validates recursive local references and serializes them for the MCP tool list', () => {
    const schema = z.object(jsonSchemaToZodShape({
      properties: { layout: { $ref: '#/$defs/split' } },
      $defs: { split: { anyOf: [
        { type: 'integer', minimum: 0 },
        { type: 'object', properties: { first: { $ref: '#/$defs/split' }, second: { $ref: '#/$defs/split' } }, required: ['first', 'second'], additionalProperties: false },
      ] } },
    }))
    expect(schema.parse({ layout: { first: 0, second: { first: 1, second: 2 } } })).toEqual({ layout: { first: 0, second: { first: 1, second: 2 } } })
    expect(schema.safeParse({ layout: { first: 0, second: { first: -1, second: 2 } } }).success).toBe(false)
    expect(schema.safeParse({ layout: { first: 0 } }).success).toBe(false)
    const json = JSON.stringify(z.toJSONSchema(schema))
    expect(json).toContain('$ref')
    expect(json).toContain('minimum')
  })

  it('keeps layout target unions strict on the Claude registration path', () => {
    const { target } = jsonSchemaToZodShape({ properties: { target: { anyOf: [
      { type: 'string', enum: ['caller', 'foreground'] },
      { type: 'object', properties: { environmentId: { type: 'string', minLength: 1 }, sessionId: { type: 'string', minLength: 1 } }, required: ['environmentId', 'sessionId'], additionalProperties: false },
    ] } } })
    expect(target.safeParse('foreground').success).toBe(true)
    expect(target.safeParse({ environmentId: 'node', sessionId: 'B' }).success).toBe(true)
    expect(target.safeParse('other').success).toBe(false)
    expect(target.safeParse({ sessionId: 'B' }).success).toBe(false)
    expect(target.safeParse({ environmentId: 'node', sessionId: 'B', extra: true }).success).toBe(false)
  })
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
