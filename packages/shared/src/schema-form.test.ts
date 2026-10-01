import { describe, expect, it } from 'vitest'
import {
  acceptedElicitationContent,
  elicitationFormRequest,
  initialSchemaFormValues,
  parseSchemaForm,
  schemaFormContent,
  validateSchemaForm,
  type SchemaFormField,
} from './schema-form'

function fields(schema: unknown): SchemaFormField[] {
  const form = parseSchemaForm(schema)
  if (!form.supported) throw new Error(`unsupported: ${form.reason}`)
  return form.fields
}

function field(property: Record<string, unknown>, required = false): SchemaFormField {
  return fields({ type: 'object', properties: { f: property }, ...(required ? { required: ['f'] } : {}) })[0]!
}

describe('parseSchemaForm: standard MCP elicitation', () => {
  it('treats an absent or empty schema as a form with no fields', () => {
    expect(parseSchemaForm(null)).toEqual({ supported: true, fields: [] })
    expect(parseSchemaForm({ type: 'object', properties: {} })).toEqual({ supported: true, fields: [] })
  })

  it('parses strings with constraints and defaults', () => {
    expect(field({ type: 'string', title: 'Email', description: 'Work address', format: 'email', minLength: 3, maxLength: 80, default: 'a@b.co' }, true))
      .toEqual({ name: 'f', label: 'Email', description: 'Work address', required: true, kind: 'text', format: 'email', minLength: 3, maxLength: 80, default: 'a@b.co' })
  })

  it('parses numbers and integers', () => {
    expect(field({ type: 'integer', minimum: 1, maximum: 9, default: 3 }))
      .toMatchObject({ kind: 'number', integer: true, minimum: 1, maximum: 9, default: 3 })
    expect(field({ type: 'number' })).toMatchObject({ kind: 'number', integer: false })
  })

  it('parses untitled, titled and legacy single-select enums', () => {
    expect(field({ type: 'string', enum: ['low', 'high'] })).toMatchObject({
      kind: 'select', options: [{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }],
    })
    expect(field({ type: 'string', oneOf: [{ const: 'a', title: 'Alpha' }], default: 'a' })).toMatchObject({
      kind: 'select', options: [{ value: 'a', label: 'Alpha' }], default: 'a',
    })
    expect(field({ type: 'string', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] })).toMatchObject({
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    })
  })

  it('parses untitled and titled multi-select arrays', () => {
    expect(field({ type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['x', 'y'] }, default: ['x'] }))
      .toMatchObject({ kind: 'multiselect', minItems: 1, maxItems: 2, default: ['x'], options: [{ value: 'x' }, { value: 'y' }] })
    expect(field({ type: 'array', items: { anyOf: [{ const: 'x', title: 'Ex' }] } }))
      .toMatchObject({ kind: 'multiselect', options: [{ value: 'x', label: 'Ex' }] })
  })
})

describe('parseSchemaForm: OpenAI extended forms', () => {
  it('keeps pattern, option descriptions and thumbnails', () => {
    expect(field({ type: 'string', format: 'uri', pattern: '^(cad|file):' })).toMatchObject({ kind: 'text', format: 'uri', pattern: '^(cad|file):' })
    expect(field({
      type: 'string',
      oneOf: [
        { const: 'hex', title: 'M6 hex bolt', description: 'Main joint', 'x-openai-thumbnail': { src: 'https://example.com/hex.png' } },
        { const: 'washer', title: 'Washer', 'x-openai-preview': { src: 'data:image/png;base64,AAAA', mimeType: 'image/png' } },
      ],
    })).toMatchObject({
      kind: 'select',
      options: [
        { value: 'hex', description: 'Main joint', thumbnail: { src: 'https://example.com/hex.png' } },
        { value: 'washer', thumbnail: { src: 'data:image/png;base64,AAAA', mimeType: 'image/png' } },
      ],
    })
  })

  it('drops unsafe thumbnails but keeps the option', () => {
    const select = field({ type: 'string', oneOf: [
      { const: 'a', title: 'A', 'x-openai-thumbnail': { src: 'http://example.com/a.png' } },
      { const: 'b', title: 'B', 'x-openai-thumbnail': { src: 'file:///etc/passwd' } },
    ] })
    expect(select).toMatchObject({ kind: 'select', options: [{ value: 'a' }, { value: 'b' }] })
    expect(select.kind === 'select' && select.options.some((o) => o.thumbnail)).toBe(false)
  })

  it('parses suggested values on strings and string arrays', () => {
    expect(field({ type: 'string', minLength: 1, 'x-openai-suggestions': [{ const: 'hex', title: 'Hex' }] }))
      .toMatchObject({ kind: 'text', minLength: 1, suggestions: [{ value: 'hex', label: 'Hex' }] })
    expect(field({ type: 'array', uniqueItems: true, items: { type: 'string', maxLength: 20, 'x-openai-suggestions': [{ const: 'washer', title: 'Washer' }] } }))
      .toMatchObject({ kind: 'text-list', uniqueItems: true, item: { maxLength: 20 }, suggestions: [{ value: 'washer' }] })
  })

  it('parses single and explicit resource selection with previews', () => {
    const options = [
      {
        uri: 'cad://parts/hex', name: 'hex.stl', title: 'Hex', mimeType: 'model/stl', size: 120,
        _meta: {
          'openai/thumbnail': { src: 'https://example.com/hex.png' },
          'openai/preview': { target: { type: 'resource_link', uri: 'cad://parts/hex', name: 'Hex' } },
        },
      },
      { uri: 'cad://parts/washer', name: 'washer.stl', _meta: { 'openai/preview': { target: { type: 'mcp_app_tool', name: 'cad.open' } } } },
    ]
    expect(field({ type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', options }, default: 'cad://parts/hex' })).toEqual({
      name: 'f', label: 'f', required: false, kind: 'resource', selection: 'single', default: 'cad://parts/hex',
      options: [
        {
          uri: 'cad://parts/hex', name: 'hex.stl', title: 'Hex', mimeType: 'model/stl', size: 120,
          thumbnail: { src: 'https://example.com/hex.png' },
          preview: { type: 'resource_link', uri: 'cad://parts/hex', name: 'Hex' },
        },
        { uri: 'cad://parts/washer', name: 'washer.stl', preview: { type: 'mcp_app_tool', name: 'cad.open', arguments: {} } },
      ],
    })
    expect(field({
      type: 'array', items: { type: 'string', format: 'uri' },
      'x-openai-input': { type: 'file', selection: 'explicit', options, userOptions: { kind: 'file', accept: ['.stl'] } },
      default: ['cad://parts/hex'],
    })).toMatchObject({ kind: 'resource', selection: 'explicit', default: ['cad://parts/hex'] })
  })

  it('parses the Bits & Bolts review form', () => {
    expect(fields({
      type: 'object',
      required: ['reference', 'priority', 'approved', 'tolerance'],
      properties: {
        reference: { type: 'string', title: 'CAD or file URI', format: 'uri', pattern: '^(cad|file):' },
        priority: { type: 'string', title: 'Priority', enum: ['low', 'normal', 'high'] },
        approved: { type: 'boolean', title: 'Approved' },
        tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
      },
    }).map((f) => f.kind)).toEqual(['text', 'select', 'boolean', 'number'])
  })
})

describe('parseSchemaForm: unsupported forms', () => {
  const unsupported: Array<[string, unknown]> = [
    ['an unknown type', { type: 'object', properties: {} }],
    ['a nested object', { type: 'object' }],
    ['an unknown string format', { type: 'string', format: 'color' }],
    ['a non-string pattern', { type: 'string', pattern: 1 }],
    ['an unknown input type', { type: 'string', format: 'uri', 'x-openai-input': { type: 'calendar', options: [] } }],
    ['implicit resource selection', { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', selection: 'implicit', options: [] } }],
    ['a selection mode on a single field', { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', selection: 'explicit', options: [] } }],
    ['a resource default outside the options', { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', options: [] }, default: 'file:///x' }],
    ['a non-URI resource field', { type: 'string', 'x-openai-input': { type: 'resource', options: [] } }],
    ['a select default outside the options', { type: 'string', enum: ['a'], default: 'b' }],
    ['non-string enum values', { type: 'string', enum: [1, 2] }],
    ['array items of another type', { type: 'array', items: { type: 'number' } }],
  ]
  it.each(unsupported)('rejects the whole form for %s', (_label, property) => {
    const form = parseSchemaForm({ type: 'object', properties: { ok: { type: 'string' }, bad: property } })
    expect(form.supported).toBe(false)
    expect(form).toMatchObject({ field: 'bad' })
  })

  it('rejects a schema that is not an object', () => {
    expect(parseSchemaForm({ type: 'array' })).toMatchObject({ supported: false })
    expect(parseSchemaForm({ type: 'object', properties: [] })).toMatchObject({ supported: false })
  })
})

describe('initialSchemaFormValues', () => {
  it('starts from defaults with booleans off', () => {
    expect(initialSchemaFormValues(fields({
      type: 'object',
      properties: {
        name: { type: 'string', default: 'x' },
        on: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, default: ['a'] },
        empty: { type: 'string' },
      },
    }))).toEqual({ name: 'x', on: false, tags: ['a'] })
  })
})

describe('validateSchemaForm', () => {
  it('requires required fields and ignores empty optional ones', () => {
    const f = fields({ type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'string', minLength: 3 } } })
    expect(validateSchemaForm(f, { a: '', b: '' })).toEqual({ a: { code: 'required' } })
    expect(validateSchemaForm(f, { a: 'x', b: 'xy' })).toEqual({ b: { code: 'minLength', limit: 3 } })
    expect(validateSchemaForm(f, { a: 'x' })).toEqual({})
  })

  it('checks text formats, patterns and code-point lengths', () => {
    const check = (property: Record<string, unknown>, value: string) => validateSchemaForm([field(property, true)], { f: value }).f
    expect(check({ type: 'string', format: 'email' }, 'nope')).toEqual({ code: 'format', limit: 'email' })
    expect(check({ type: 'string', format: 'email' }, 'a@b.co')).toBeUndefined()
    expect(check({ type: 'string', format: 'uri' }, 'cad://parts/hex')).toBeUndefined()
    expect(check({ type: 'string', format: 'uri' }, 'not a uri')).toMatchObject({ code: 'format' })
    expect(check({ type: 'string', format: 'date' }, '2026-02-30')).toMatchObject({ code: 'format' })
    expect(check({ type: 'string', format: 'date' }, '2026-02-28')).toBeUndefined()
    expect(check({ type: 'string', format: 'date-time' }, '2026-10-01T09:00:00Z')).toBeUndefined()
    expect(check({ type: 'string', format: 'date-time' }, '2026-10-01 25:00')).toMatchObject({ code: 'format' })
    expect(check({ type: 'string', format: 'uri', pattern: '^(cad|file):' }, 'https://x.y')).toEqual({ code: 'pattern', limit: '^(cad|file):' })
    expect(check({ type: 'string', maxLength: 2 }, '👍👍')).toBeUndefined()
  })

  it('checks numbers', () => {
    const f = [field({ type: 'integer', minimum: 0, maximum: 10 }, true)]
    expect(validateSchemaForm(f, { f: 1.5 }).f).toEqual({ code: 'integer' })
    expect(validateSchemaForm(f, { f: 11 }).f).toEqual({ code: 'maximum', limit: 10 })
    expect(validateSchemaForm(f, { f: '3' }).f).toEqual({ code: 'type' })
    expect(validateSchemaForm(f, { f: 3 })).toEqual({})
  })

  it('keeps selections inside the offered options', () => {
    const select = [field({ type: 'string', enum: ['a', 'b'] }, true)]
    expect(validateSchemaForm(select, { f: 'c' }).f).toEqual({ code: 'option' })
    const multi = [field({ type: 'array', maxItems: 1, items: { type: 'string', enum: ['a', 'b'] } }, true)]
    expect(validateSchemaForm(multi, { f: ['a', 'b'] }).f).toEqual({ code: 'maxItems', limit: 1 })
    expect(validateSchemaForm(multi, { f: ['a', 'a'] }).f).toEqual({ code: 'unique' })
  })

  it('only lets supplied resource URIs through, even when userOptions are declared', () => {
    const resource = [field({
      type: 'array', items: { type: 'string', format: 'uri' },
      'x-openai-input': { type: 'resource', options: [{ uri: 'cad://a', name: 'a' }], userOptions: { kind: 'file' } },
    }, true)]
    expect(validateSchemaForm(resource, { f: ['file:///etc/passwd'] }).f).toEqual({ code: 'option' })
    expect(validateSchemaForm(resource, { f: ['cad://a'] })).toEqual({})
    // A required multi-select may be empty, as in JSON Schema; minItems is the bound.
    expect(validateSchemaForm(resource, { f: [] })).toEqual({})
  })

  it('validates free-text list items and uniqueness', () => {
    const list = [field({ type: 'array', uniqueItems: true, items: { type: 'string', minLength: 2 } })]
    expect(validateSchemaForm(list, { f: ['ok', 'x'] }).f).toEqual({ code: 'minLength', limit: 2 })
    expect(validateSchemaForm(list, { f: ['ok', 'ok'] }).f).toEqual({ code: 'unique' })
  })
})

describe('schemaFormContent', () => {
  it('omits unanswered optional fields and keeps required ones as entered', () => {
    const f = fields({
      type: 'object',
      required: ['refs'],
      properties: {
        note: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        on: { type: 'boolean' },
        refs: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', options: [{ uri: 'cad://a', name: 'a' }] } },
      },
    })
    expect(schemaFormContent(f, { note: '', tags: [], on: false, refs: [] })).toEqual({ on: false, refs: [] })
  })
})

describe('elicitationFormRequest', () => {
  it('adds nothing for a form without fields', () => {
    expect(elicitationFormRequest({ type: 'object', properties: {} })).toEqual({})
    expect(elicitationFormRequest(undefined)).toEqual({})
  })

  it('derives the legacy field list only for forms old phones can render', () => {
    expect(elicitationFormRequest({ type: 'object', properties: { p: { type: 'string', oneOf: [{ const: 'a', title: 'A' }] } } }).elicitationForm)
      .toEqual([{ name: 'p', label: 'p', required: false, type: 'enum', enumOptions: ['a'] }])
    expect(elicitationFormRequest({ type: 'object', properties: { p: { type: 'array', items: { type: 'string' } } } }))
      .toEqual({ schemaForm: { supported: true, fields: [expect.objectContaining({ kind: 'text-list' })] } })
  })
})

describe('acceptedElicitationContent', () => {
  it('accepts anything for a form without fields and nothing for an unsupported one', () => {
    expect(acceptedElicitationContent(undefined, { a: 1 })).toEqual({ ok: true, content: {} })
    expect(acceptedElicitationContent({ supported: false, reason: 'x' }, {})).toMatchObject({ ok: false })
  })
})

describe('server-supplied patterns', () => {
  const timed = <T>(run: () => T): T => {
    const start = performance.now()
    const result = run()
    expect(performance.now() - start).toBeLessThan(1000)
    return result
  }

  const textForm = (property: Record<string, unknown>) => timed(() => fields({ type: 'object', properties: { f: { type: 'string', ...property } } }))

  it('hints a catastrophic-backtracking pattern and its default without stalling', () => {
    const parsed = textForm({ pattern: '^(a+)+$', default: `${'a'.repeat(5000)}!` })
    expect(timed(() => validateSchemaForm(parsed, initialSchemaFormValues(parsed)))).toEqual({
      f: { code: 'pattern', limit: '^(a+)+$' },
    })
  })

  it('never runs a pattern or format in main, but keeps structural checks', () => {
    const parsed = textForm({ pattern: 'a{9998}b', format: 'email', minLength: 2 })
    const value = `${'a'.repeat(200_000)}!`
    expect(timed(() => acceptedElicitationContent({ supported: true, fields: parsed }, { f: value }))).toEqual({ ok: true, content: { f: value } })
    expect(acceptedElicitationContent({ supported: true, fields: parsed }, { f: 'a' })).toEqual({ ok: false, reason: 'f: minLength' })
    expect(acceptedElicitationContent({ supported: true, fields: parsed }, { f: 1 })).toEqual({ ok: false, reason: 'f: type' })
  })

  it.each([
    ['a backreference', '(a)\\1'],
    ['lookaround', '^(?=a)'],
    ['invalid syntax', '('],
    ['an empty repetition', '(?:){1000000000}'],
    ['nested empty repetitions', '((?:){1000}){1000}'],
    ['deep nesting', `${'('.repeat(100)}a${')'.repeat(100)}`],
  ])('skips the hint for a pattern with %s instead of rejecting the form', (_, pattern) => {
    const parsed = textForm({ pattern })
    expect(parsed).toEqual([expect.objectContaining({ kind: 'text', pattern })])
    expect(timed(() => validateSchemaForm(parsed, { f: 'zz' }))).toEqual({})
  })

  it('skips the hint when a match exceeds its budget', () => {
    const parsed = textForm({ pattern: 'a{9998}b', default: `${'a'.repeat(200_000)}!` })
    expect(timed(() => validateSchemaForm(parsed, initialSchemaFormValues(parsed)))).toEqual({})
  })

  it('shares one budget across the form', () => {
    const heavy = { type: 'string', pattern: 'a{9998}b' }
    const cheap = { type: 'string', pattern: '^x$' }
    const value = `${'a'.repeat(200_000)}!`
    const heavyFields = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`h${i}`, heavy]))
    const form = fields({ type: 'object', properties: { ...heavyFields, cheap } })
    const values = { ...Object.fromEntries(Object.keys(heavyFields).map((name) => [name, value])), cheap: 'y' }
    expect(timed(() => validateSchemaForm(form, values))).toEqual({})
    expect(validateSchemaForm(fields({ type: 'object', properties: { cheap } }), { cheap: 'y' })).toEqual({ cheap: { code: 'pattern', limit: '^x$' } })
  })

  it('keeps hinting after the pattern cache churns', () => {
    const cad = [field({ type: 'string', pattern: '^(cad|file):' }, true)]
    expect(validateSchemaForm(cad, { f: 'https://x.y' }).f).toMatchObject({ code: 'pattern' })
    for (let i = 0; i < 200; i++) validateSchemaForm([field({ type: 'string', pattern: `^${'x'.repeat(i)}$` }, true)], { f: 'y' })
    expect(validateSchemaForm(cad, { f: 'https://x.y' }).f).toMatchObject({ code: 'pattern' })
    expect(validateSchemaForm(cad, { f: 'cad://parts/hex' })).toEqual({})
  })

  it('still validates ordinary patterns', () => {
    const cad = [field({ type: 'string', pattern: '^(cad|file):' }, true)]
    expect(validateSchemaForm(cad, { f: 'cad://parts/hex' })).toEqual({})
    expect(validateSchemaForm(cad, { f: 'https://x.y' }).f).toMatchObject({ code: 'pattern' })
    const email = [field({ type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' }, true)]
    expect(validateSchemaForm(email, { f: 'name@example.com' })).toEqual({})
    expect(timed(() => validateSchemaForm(email, { f: `a@${'.'.repeat(5000)}@` })).f).toMatchObject({ code: 'pattern' })
  })

  it('checks the email format without a backtracking regex', () => {
    const email = [field({ type: 'string', format: 'email' }, true)]
    expect(timed(() => validateSchemaForm(email, { f: `a@${'.'.repeat(50000)}@` })).f).toEqual({ code: 'format', limit: 'email' })
    for (const bad of ['a@b', '@b.co', 'a@b.', 'a@.co', 'a b@c.co', 'a@b@c.co']) {
      expect(validateSchemaForm(email, { f: bad }).f).toMatchObject({ code: 'format' })
    }
  })
})

describe('patterns parsed elsewhere', () => {
  it('skips the hint for a pattern this runtime cannot compile instead of throwing', () => {
    const received: SchemaFormField[] = [{ name: 'f', label: 'f', required: true, kind: 'text', pattern: '(a)\\1' }]
    expect(validateSchemaForm(received, { f: 'aa' })).toEqual({})
  })
})
