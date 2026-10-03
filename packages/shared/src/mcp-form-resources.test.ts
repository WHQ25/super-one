import { describe, expect, it } from 'vitest'
import { matchesResourceAccept, validResourceAccept } from './mcp-form-resources'
import { acceptedElicitationContent, initialSchemaFormValues, parseSchemaForm, schemaFormForResourceHost } from './schema-form'

const schema = (input: Record<string, unknown>) => ({ type: 'object', properties: { refs: {
  type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', options: [{ uri: 'cad://a', name: 'a' }], ...input },
} } })

describe('native resource forms', () => {
  it('requires a trusted host capability and initializes implicit selection to all remaining options', () => {
    const raw = schema({ selection: 'implicit' })
    expect(parseSchemaForm(raw).supported).toBe(false)
    const form = parseSchemaForm(raw, { userResources: true })
    expect(form).toMatchObject({ supported: true, fields: [{ userOptions: { kind: 'file' }, selection: 'implicit' }] })
    if (form.supported) expect(initialSchemaFormValues(form.fields)).toEqual({ refs: ['cad://a'] })
    expect(schemaFormForResourceHost(form, false).supported).toBe(false)
  })
  it('keeps explicit server choices on clients without a native picker and never accepts arbitrary user paths', () => {
    const form = parseSchemaForm(schema({ userOptions: { kind: 'file', accept: ['.stl', 'image/*'] } }), { userResources: true })
    expect(schemaFormForResourceHost(form, false)).toMatchObject({ supported: true, fields: [{ options: [{ uri: 'cad://a' }] }] })
    const web = schemaFormForResourceHost(form, false)
    if (web.supported && web.fields[0].kind === 'resource') expect(web.fields[0].userOptions).toBeUndefined()
    expect(acceptedElicitationContent(form, { refs: ['file:///etc/passwd'] }).ok).toBe(false)
  })
  it('refuses invalid filters, unknown kinds, directory filters and implicit defaults', () => {
    for (const userOptions of [{ kind: 'network' }, { accept: ['*'] }, { accept: ['.stl/../*'] }, { kind: 'directory', accept: ['.stl'] }]) {
      expect(parseSchemaForm(schema({ userOptions }), { userResources: true }).supported).toBe(false)
    }
    const raw = schema({ selection: 'implicit' }); Object.assign(raw.properties.refs, { default: ['cad://a'] })
    expect(parseSchemaForm(raw, { userResources: true }).supported).toBe(false)
  })
})

describe('resource accept rules', () => {
  it.each(['.STL', '.tar.gz', 'image/*', 'model/stl', 'application/vnd.foo+json'])('accepts %s as a filter', rule => expect(validResourceAccept(rule)).toBe(true))
  it.each(['file:///x', '*', 'image/../*', ' image/png', '.pdf, .txt'])('rejects malformed %s', rule => expect(validResourceAccept(rule)).toBe(false))
  it('matches extension suffixes and MIME alternatives case-insensitively', () => {
    expect(matchesResourceAccept('PART.STL', 'model/stl', ['.stl'])).toBe(true)
    expect(matchesResourceAccept('parts.tar.gz', 'application/gzip', ['.tar.gz'])).toBe(true)
    expect(matchesResourceAccept('picture.png', 'image/png', ['image/*'])).toBe(true)
    expect(matchesResourceAccept('part.txt', 'text/plain', ['.stl', 'model/*'])).toBe(false)
    expect(matchesResourceAccept('picture.png', 'image/png', [])).toBe(true)
  })
})
