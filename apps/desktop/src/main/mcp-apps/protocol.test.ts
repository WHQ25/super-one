import { describe, expect, it } from 'vitest'
import { McpAppResourceRegistry, mcpAppStorageOrigin } from './protocol'
import { deniesMcpAppPermission } from './frame-security'
import { mcpAppAllowAttribute } from '@superone/shared/mcp-apps-host/csp'
import { MCP_APP_HTML_MAX_BYTES } from '@superone/shared/mcp-apps'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

const app: ToolAppAttachment = { appInstanceId: 'one', binding: { node: 'node', session: 'session', account: 'account', server: 'fixture', configGeneration: 1, configFingerprint: 'stable' }, resourceUri: 'ui://fixture/items', resource: { html: '<h1>Items</h1>', meta: { permissions: { camera: {} }, csp: { connectDomains: ['https://api.example.test'] } }, hash: 'html' }, status: 'result' }

describe('MCP App native snapshots', () => {
  it('keeps storage across generations and isolates persistent identities', () => {
    const origin = mcpAppStorageOrigin(app.binding)
    expect(mcpAppStorageOrigin({ ...app.binding, configGeneration: 999 })).toBe(origin)
    for (const key of ['node', 'session', 'server', 'account', 'configFingerprint'] as const) expect(mcpAppStorageOrigin({ ...app.binding, [key]: 'another' })).not.toBe(origin)
  })

  it('serves only registered snapshots under CSP and no granted permissions', () => {
    const resources = new McpAppResourceRegistry()
    const registration = resources.register(app, 1, 'superone-renderer://app/index.html')
    const response = resources.handle(new Request(registration.url))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("form-action 'none'")
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors superone-renderer://app')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(mcpAppAllowAttribute({})).toBe('') // Resource declarations are never passed as grants.
    expect(deniesMcpAppPermission(registration.origin)).toBe(true)
    expect(deniesMcpAppPermission('https://embedded.test', undefined, registration.origin)).toBe(true)
    expect(resources.handle(new Request(`${registration.origin}/etc/passwd`)).status).toBe(404)
    expect(resources.handle(new Request(registration.url, { headers: { origin: 'https://attacker.test' } })).status).toBe(403)
  })

  it('revokes native execution and ignores release by another owner', () => {
    const resources = new McpAppResourceRegistry()
    const registration = resources.register(app, 1, 'superone-renderer://app')
    resources.release(registration.id, 2)
    expect(resources.isActive(registration.url, 1)).toBe(true)
    expect(resources.isActive(registration.url, 2)).toBe(false)
    resources.revoke(registration.url)
    expect(resources.isActive(registration.url, 1)).toBe(false)
    expect(resources.handle(new Request(registration.url)).status).toBe(404)
  })

  it('rejects oversized snapshots and untrusted containers', () => {
    const resources = new McpAppResourceRegistry()
    expect(() => resources.register({ ...app, resource: { ...app.resource!, html: 'a'.repeat(MCP_APP_HTML_MAX_BYTES + 1) } }, 1, 'superone-renderer://app')).toThrow('size limit')
    expect(() => resources.register(app, 1, 'superone-mcp-app://attacker')).toThrow('Untrusted')
  })

  it('binds a native lifetime to owner, scoped View and immutable provider identity', () => {
    const resources = new McpAppResourceRegistry()
    const registration = resources.register(app, 1, 'superone-renderer://app', 'connection:session')
    const lease = resources.lease(registration.id, 1, 'connection:session', app.appInstanceId)
    for (const [owner, scope, id] of [[2, 'connection:session', app.appInstanceId], [1, 'connection:another', app.appInstanceId], [1, 'connection:session', 'another']] as const) {
      expect(() => resources.lease(registration.id, owner, scope, id)).toThrow('does not own')
    }
    const { configFingerprint, ...rest } = app.binding
    lease.validate({ ...app, binding: { configFingerprint, ...rest } })
    expect(() => lease.validate({ ...app, binding: { ...app.binding, account: 'another' } })).toThrow('binding changed')
    resources.revoke(`${registration.url}#same-document`)
    expect(lease.signal.aborted).toBe(true)
    expect(() => lease.validate(app)).toThrow('revoked')
  })

  it.each(['document', 'owner'] as const)('aborts native executions when the %s is released', kind => {
    const resources = new McpAppResourceRegistry()
    const registration = resources.register(app, 1, 'superone-renderer://app', 'connection:session')
    const lease = resources.lease(registration.id, 1, 'connection:session', app.appInstanceId)
    if (kind === 'owner') resources.releaseOwner(1)
    else resources.release(registration.id, 1)
    expect(lease.signal.aborted).toBe(true)
    expect(() => resources.lease(registration.id, 1, 'connection:session', app.appInstanceId)).toThrow('does not own')
  })
})
