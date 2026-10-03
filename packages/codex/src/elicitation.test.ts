import { describe, expect, it } from 'vitest'
import { codexElicitationRequest } from './elicitation'

describe('Codex elicitation request', () => {
  it.each(['form', 'openaiForm', 'openai/form'])('parses %s using the shared form model', mode => {
    expect(codexElicitationRequest('id', { mode, serverName: 'cad', message: 'Choose',
      requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      _meta: { subtitle: 'Part', riskLevel: 'low', persist: ['always'] },
    })).toMatchObject({ requestKind: 'mcp_elicitation', serverName: 'cad', subtitle: 'Part', riskLevel: 'low',
      supportsAlwaysPersist: true, allowAlwaysAllow: false, schemaForm: { supported: true }, elicitationForm: [{ name: 'name' }] })
  })
  it('only offers persistent approval for a request without fields', () => {
    expect(codexElicitationRequest('id', { _meta: { persist: ['always'] } })).toMatchObject({ allowAlwaysAllow: true })
    expect(codexElicitationRequest('id', { mode: 'openai/userVerification' })).toBeUndefined()
    expect(codexElicitationRequest('id', { requestedSchema: { type: 'array' } })).toMatchObject({ allowAlwaysAllow: false, schemaForm: { supported: false } })
  })
})
