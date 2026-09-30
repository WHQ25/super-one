import { createHash, randomUUID } from 'node:crypto'
import type { CustomScheme, Protocol } from 'electron'
import { buildMcpAppCsp } from '@superone/shared/mcp-apps-host/csp'
import { MCP_APP_HTML_MAX_BYTES, MCP_APP_DATA_MAX_BYTES, McpAppsError, assertMcpAppSize } from '@superone/shared/mcp-apps'
import type { McpAppsBinding, ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppDocumentRegistration } from '@superone/shared/mcp-apps-desktop'

export const MCP_APP_SCHEME = 'superone-mcp-app'
export const MCP_APP_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: MCP_APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}

export function isMcpAppUrl(value: string | undefined): boolean {
  try { return new URL(value ?? '').protocol === `${MCP_APP_SCHEME}:` } catch { return false }
}

/** URL.origin is "null" for custom schemes in Node; Chromium's standard scheme has a real origin. */
export function mcpAppUrlOrigin(value: string): string | undefined {
  try { const url = new URL(value); return isMcpAppUrl(value) ? `${url.protocol}//${url.host}` : undefined } catch { return undefined }
}

export function mcpAppStorageOrigin(binding: McpAppsBinding): string {
  const { node, session, server, account, configFingerprint } = binding
  const key = createHash('sha256').update(JSON.stringify({ node, session, server, account, configFingerprint })).digest('hex')
  return `${MCP_APP_SCHEME}://${key}`
}

export type McpAppRegistration = McpAppDocumentRegistration
interface Snapshot extends McpAppRegistration { owner: number; resource: NonNullable<ToolAppAttachment['resource']>; hostOrigin: string; revoked: boolean; scope?: string; identity: string; lifetime: AbortController }

function documentIdentity(app: ToolAppAttachment): string {
  const b = app.binding
  return JSON.stringify([app.appInstanceId, b.node, b.session, b.server, b.account, b.configGeneration, b.configFingerprint, app.resourceUri, app.origin?.providerSessionId, app.origin?.originCallId])
}

/** Registered, bounded snapshots only. The iframe never selects a filesystem path or provider. */
export class McpAppResourceRegistry {
  private snapshots = new Map<string, Snapshot>()

  register(app: ToolAppAttachment, owner: number, hostUrl: string, scope?: string): McpAppRegistration {
    if (!app.resource) throw new McpAppsError('invalid', 'MCP App HTML is unavailable')
    if (Buffer.byteLength(app.resource.html, 'utf8') > MCP_APP_HTML_MAX_BYTES) throw new McpAppsError('invalid', 'MCP App HTML exceeds the size limit')
    assertMcpAppSize(app.resource.meta, MCP_APP_DATA_MAX_BYTES)
    const host = new URL(hostUrl)
    if (host.username || host.password || !['superone-renderer:', 'http:', 'https:'].includes(host.protocol)) throw new McpAppsError('denied', 'Untrusted MCP App container')
    const hostOrigin = `${host.protocol}//${host.host}`
    const origin = mcpAppStorageOrigin(app.binding)
    const id = randomUUID()
    const record: Snapshot = { id, origin, url: `${origin}/views/${id}/index.html`, appInstanceId: app.appInstanceId, owner, resource: app.resource, hostOrigin, revoked: false, scope, identity: documentIdentity(app), lifetime: new AbortController() }
    this.snapshots.set(record.url, record)
    return { id, origin, url: record.url, appInstanceId: record.appInstanceId }
  }

  private find(url: string): Snapshot | undefined {
    try { const parsed = new URL(url); parsed.hash = ''; return this.snapshots.get(parsed.href) } catch { return undefined }
  }

  isActive(url: string, owner?: number): boolean {
    const record = this.find(url)
    return Boolean(record && !record.revoked && (owner === undefined || owner === record.owner))
  }

  lease(id: string, owner: number, scope: string, appInstanceId: string): { signal: AbortSignal; validate(app: ToolAppAttachment): void } {
    const record = [...this.snapshots.values()].find(value => value.id === id)
    if (!record || record.owner !== owner || record.scope !== scope || record.appInstanceId !== appInstanceId) throw new McpAppsError('denied', 'MCP App document does not own this View')
    if (record.revoked) throw new McpAppsError('cancelled', 'MCP App document was revoked')
    return { signal: record.lifetime.signal, validate: app => {
      if (record.revoked || record.lifetime.signal.aborted) throw new McpAppsError('cancelled', 'MCP App document was revoked')
      if (documentIdentity(app) !== record.identity) throw new McpAppsError('denied', 'MCP App document provider binding changed')
    } }
  }

  revoke(url: string): void {
    const record = this.find(url)
    if (record) { record.revoked = true; record.lifetime.abort() }
  }
  release(id: string, owner: number): void {
    for (const [url, record] of this.snapshots) if (record.id === id && record.owner === owner) { record.lifetime.abort(); this.snapshots.delete(url) }
  }
  releaseOwner(owner: number): void {
    for (const [url, record] of this.snapshots) if (record.owner === owner) { record.lifetime.abort(); this.snapshots.delete(url) }
  }

  handle(request: Request): Response {
    const record = this.find(request.url)
    if (!record || record.revoked || request.method !== 'GET') return new Response(null, { status: 404 })
    const origin = request.headers.get('origin')
    if (origin && origin !== record.origin) return new Response(null, { status: 403 })
    return new Response(record.resource.html, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `${buildMcpAppCsp(record.resource.meta.csp)}; frame-ancestors ${record.hostOrigin}; sandbox allow-scripts allow-same-origin allow-forms`,
      // Declarations are requests, never grants. No device permission UI is exposed yet.
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-write=(), display-capture=()',
      'X-Content-Type-Options': 'nosniff',
    } })
  }
}

export const mcpAppResources = new McpAppResourceRegistry()
export function registerMcpAppProtocol(proto: Protocol, resources = mcpAppResources): void {
  proto.handle(MCP_APP_SCHEME, request => resources.handle(request))
}
