import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileLinearRegex, type MatchBudget } from './linear-regex'
import { parseSchemaForm, validateSchemaForm, type SchemaFormField } from './schema-form'

vi.mock('./linear-regex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./linear-regex')>()
  return { ...actual, compileLinearRegex: vi.fn(actual.compileLinearRegex) }
})

const actual = await vi.importActual<typeof import('./linear-regex')>('./linear-regex')

/** Total budget steps charged by compiling, counted per call. */
function chargeMeter() {
  const meter = { calls: 0, charged: 0 }
  vi.mocked(compileLinearRegex).mockImplementation((pattern: string, budget?: MatchBudget) => {
    meter.calls++
    const before = budget!.steps
    try {
      return actual.compileLinearRegex(pattern, budget)
    } finally {
      meter.charged += before - budget!.steps
    }
  })
  return meter
}

function textFields(count: number, pattern: (i: number) => string): Record<string, unknown> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, { type: 'string', pattern: pattern(i), default: 'y' }]))
}

afterEach(() => { vi.mocked(compileLinearRegex).mockClear() })

describe('form size caps', () => {
  it('rejects a form with too many fields before parsing any of them', () => {
    expect(parseSchemaForm({ type: 'object', properties: textFields(5000, (i) => `((?:){1000}){1000}x${i}`) }))
      .toEqual({ supported: false, reason: 'more than 100 fields' })
    expect(compileLinearRegex).not.toHaveBeenCalled()
  })

  it('rejects an oversized schema', () => {
    expect(parseSchemaForm({ type: 'object', properties: { f: { type: 'string', description: 'x'.repeat(1_000_001) } } }))
      .toEqual({ supported: false, reason: 'the schema is too large' })
    const options = Array.from({ length: 200_000 }, (_, i) => ({ const: `${i}`, title: `Option ${i}` }))
    expect(parseSchemaForm({ type: 'object', properties: { f: { type: 'string', oneOf: options } } }))
      .toEqual({ supported: false, reason: 'the schema is too large' })
  })
})

describe('one budget for compiling and matching', () => {
  it('stops compiling distinct costly patterns once the form budget is spent', () => {
    const form = parseSchemaForm({ type: 'object', properties: textFields(100, (i) => `((?:){1000}){1000}x${i}`) })
    if (!form.supported) throw new Error(form.reason)
    const meter = chargeMeter()
    // Twice: failed compiles are cached, but the LRU may have churned them out by the next validation.
    for (let round = 0; round < 2; round++) {
      expect(validateSchemaForm(form.fields, Object.fromEntries(form.fields.map((f) => [f.name, 'y'])))).toEqual({})
    }
    // At most one compile (100k node visits plus the source) past the 1M budget per validation.
    expect(meter.charged).toBeLessThanOrEqual(2 * (1_000_000 + 100_001 + 2048))
    expect(meter.calls).toBeLessThan(2 * 12)
  })

  it('never compiles or caches an oversized pattern', () => {
    const big = `^${'a'.repeat(3000)}$`
    const received: SchemaFormField[] = [{ name: 'f', label: 'f', required: true, kind: 'text', pattern: big }]
    expect(validateSchemaForm(received, { f: 'b' })).toEqual({})
    expect(compileLinearRegex).not.toHaveBeenCalled()
  })
})
