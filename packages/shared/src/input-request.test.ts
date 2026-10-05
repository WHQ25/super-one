import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { admitInputRequestSpec, fileUriFromPath, inputRequestMessageText, parseInputRequestError } from './input-request'
import { parseSchemaForm } from './schema-form'

const bugReport = {
  title: 'Report a bug',
  requestedSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', title: 'Summary' },
      severity: { type: 'string', title: 'Severity', oneOf: [{ const: 'low', title: 'Low' }, { const: 'high', title: 'High' }] },
      details: { type: 'string', title: 'Details' },
      blocking: { type: 'boolean', title: 'Blocking' },
    },
    required: ['summary'],
  },
}

const fileField = {
  title: 'Attach',
  requestedSchema: {
    type: 'object',
    properties: {
      shot: {
        type: 'array',
        items: { type: 'string', format: 'uri' },
        title: 'Screenshot',
        'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'file', accept: ['image/*'] } },
      },
    },
  },
}

describe('admitInputRequestSpec', () => {
  it('admits a flat elicitation form and trims its text', () => {
    const admitted = admitInputRequestSpec({ ...bugReport, title: '  Report a bug ', submitLabel: 'Report' }, { userResources: false })
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    expect(admitted.spec.title).toBe('Report a bug')
    expect(admitted.spec.submitLabel).toBe('Report')
    expect(admitted.form.fields.map(field => field.kind)).toEqual(['text', 'select', 'text', 'boolean'])
  })

  it('rejects unknown keys, missing titles and empty or unsupported forms whole', () => {
    expect(admitInputRequestSpec({ ...bugReport, onSubmit: 'x' }, { userResources: false })).toEqual({ ok: false, error: 'Unknown form properties: onSubmit' })
    expect(admitInputRequestSpec({ ...bugReport, title: ' ' }, { userResources: false }).ok).toBe(false)
    expect(admitInputRequestSpec({ title: 'Empty', requestedSchema: { type: 'object', properties: {} } }, { userResources: false }))
      .toEqual({ ok: false, error: 'The form has no fields' })
    const nested = admitInputRequestSpec({ title: 'Nested', requestedSchema: { type: 'object', properties: { a: { type: 'object' } } } }, { userResources: false })
    expect(nested.ok).toBe(false)
    expect(nested.ok ? '' : nested.error).toMatch(/field "a"/)
    expect(admitInputRequestSpec({ title: 'No schema' }, { userResources: false }).ok).toBe(false)
  })

  it('rejects option previews, which need the asking MCP server', () => {
    const admitted = admitInputRequestSpec({
      title: 'Pick',
      requestedSchema: {
        type: 'object',
        properties: {
          doc: {
            type: 'string', format: 'uri', title: 'Doc',
            'x-openai-input': { type: 'resource', options: [{ uri: 'a://1', name: 'One', _meta: { 'openai/preview': { target: { type: 'resource_link', uri: 'a://1', name: 'One' } } } }] },
          },
        },
      },
    }, { userResources: true })
    expect(admitted.ok ? '' : admitted.error).toMatch(/option previews/)
  })

  it('rejects an oversized spec', () => {
    const admitted = admitInputRequestSpec({ ...bugReport, description: 'x'.repeat(70 * 1024) }, { userResources: false })
    expect(admitted).toEqual({ ok: false, error: 'The form is larger than 64 KiB' })
  })

  it('keeps file fields only where the host can prove the user picked the file', () => {
    expect(admitInputRequestSpec(fileField, { userResources: true }).ok).toBe(true)
    const remote = admitInputRequestSpec(fileField, { userResources: false })
    expect(remote.ok ? '' : remote.error).toMatch(/Field "shot" asks for user files/)
  })
})

describe('inputRequestMessageText', () => {
  it('renders answered fields in form order with labels, choices and multi-line text', () => {
    const form = parseSchemaForm(bugReport.requestedSchema)
    const text = inputRequestMessageText({ title: 'Report a bug' }, form, {
      blocking: true,
      summary: 'Crash on save',
      severity: 'high',
      details: 'Step 1\nStep 2',
    })
    expect(text).toBe('Report a bug\nSummary: Crash on save\nSeverity: High (high)\nDetails:\n  Step 1\n  Step 2\nBlocking: Yes')
  })

  it('shows picked files as host paths', () => {
    const form = parseSchemaForm(fileField.requestedSchema, { userResources: true })
    const text = inputRequestMessageText({ title: 'Attach' }, form, { shot: [fileUriFromPath('/tmp/a b/shot.png')] })
    expect(text).toBe('Attach\nScreenshot: /tmp/a b/shot.png')
  })
})

describe('parseInputRequestError', () => {
  it('finds the code inside wrapped IPC text and ignores other failures', () => {
    const text = `Error invoking remote method 'agent:send-message': Error: ${'[input_request:invalid] summary: required'}`
    expect(parseInputRequestError(text)).toEqual({ code: 'invalid', message: 'summary: required' })
    expect(parseInputRequestError('network down')).toBeNull()
  })
})

describe('fileUriFromPath', () => {
  it('round-trips through the host URL parser', () => {
    for (const path of ['/Users/me/My Files/report #1.png', '/tmp/中文/截图.png']) {
      expect(fileURLToPath(fileUriFromPath(path))).toBe(path)
    }
    expect(fileUriFromPath('C:\\Users\\me\\a b.png')).toBe('file:///C:/Users/me/a%20b.png')
  })
})
