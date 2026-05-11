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
})
