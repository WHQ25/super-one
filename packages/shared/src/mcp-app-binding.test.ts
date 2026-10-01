import { expect, it } from 'vitest'
import { assertMcpAppsBindingIdentity } from './mcp-app-binding'

const binding = { node: 'local', session: 's', server: 'cad', account: 'a', configGeneration: 0, configFingerprint: 'cfg' }
const origin = { providerSessionId: 'thread' }
const current = { session: 's', providerSessionId: 'thread', account: 'a', configFingerprint: 'cfg' }

it.each(['session', 'providerSessionId', 'account', 'configFingerprint'] as const)('fails closed when current %s changed', key => {
  expect(() => assertMcpAppsBindingIdentity(binding, origin, { ...current, [key]: 'other' })).toThrow(expect.objectContaining({ code: key === 'session' || key === 'providerSessionId' ? 'inactive' : 'not_connected' }))
})

it('treats a null default account as the same undefined binding account', () => {
  expect(() => assertMcpAppsBindingIdentity({ ...binding, account: undefined }, origin, { ...current, account: null })).not.toThrow()
})
