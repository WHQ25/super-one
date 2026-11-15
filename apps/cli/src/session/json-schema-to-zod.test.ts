import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToZodShape } from './json-schema-to-zod'

describe('jsonSchemaToZodShape', () => {
  it('accepts a JSON-encoded object string and still rejects other values', () => {
    const schema = z.object(jsonSchemaToZodShape({
      type: 'object',
      properties: {
        data: { type: 'object', additionalProperties: true },
        inputSchema: { type: 'object', additionalProperties: true },
      },
      required: ['data'],
    }))
    expect(schema.parse({
      data: '{"images":[1]}',
      inputSchema: '{"type":"object"}',
    })).toEqual({ data: { images: [1] }, inputSchema: { type: 'object' } })
    expect(schema.safeParse({ data: true }).success).toBe(false)
    expect(schema.safeParse({ data: '[]' }).success).toBe(false)
    expect(schema.safeParse({ data: '{oops' }).success).toBe(false)
  })

  it('accepts a JSON-encoded array string and still rejects other values', () => {
    const schema = z.object(jsonSchemaToZodShape({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
    }))
    expect(schema.parse({ tags: '["a","b"]' })).toEqual({ tags: ['a', 'b'] })
    expect(schema.safeParse({ tags: '{"a":1}' }).success).toBe(false)
    expect(schema.safeParse({ tags: 'nope' }).success).toBe(false)
  })
})
