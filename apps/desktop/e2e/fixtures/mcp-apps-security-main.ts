/** Isolated native test host using production scheme and guards, never the user's profile. */
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { MCP_APP_SCHEME_PRIVILEGES, McpAppResourceRegistry, registerMcpAppProtocol } from '../../src/main/mcp-apps/protocol'
import { attachMcpAppFrameGuards, deniesMcpAppPermission, MCP_APP_DOCUMENT_REVOKED } from '../../src/main/mcp-apps/frame-security'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

app.setPath('userData', process.env.MCP_APPS_SECURITY_PROFILE!)
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
protocol.registerSchemesAsPrivileged([MCP_APP_SCHEME_PRIVILEGES,
  { scheme: 'local-file', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'superone-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'superone-renderer', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
async function start(): Promise<void> {
  await app.whenReady()
  const directory = process.env.MCP_APPS_SECURITY_BUILD!
  const permissionsWithoutPolicy = new Set<string>()
  class SecurityResources extends McpAppResourceRegistry {
    override handle(request: Request): Response {
      const response = super.handle(request)
      // An explicit negative probe removes header policy to exercise Electron's native denial independently.
      if (permissionsWithoutPolicy.has(request.url)) response.headers.delete('Permissions-Policy')
      return response
    }
  }
  const resources = new SecurityResources()
  const leaseSignals = new Map<string, AbortSignal>()
  registerMcpAppProtocol(protocol, resources)
  const internalAttempts: string[] = []
  for (const scheme of ['local-file', 'superone-app', 'file']) protocol.handle(scheme, request => {
    internalAttempts.push(request.url)
    return new Response('window.fixtureProbeReached = true', { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } })
  })
  protocol.handle('superone-renderer', request => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/forbidden-')) {
      internalAttempts.push(request.url)
      return new Response('window.fixtureProbeReached = true', { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } })
    }
    if (url.pathname === '/host.js') return new Response(readFileSync(join(directory, 'host.js')), { headers: { 'content-type': 'text/javascript' } })
    if (url.pathname === '/dockview.css') return new Response(readFileSync(join(directory, 'dockview.css')), { headers: { 'content-type': 'text/css' } })
    return new Response('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/dockview.css"><style>iframe[data-mcp-app-frame]{display:block;width:100%;height:100%;border:0}.h-full{height:100%}.w-full{width:100%}</style></head><body><script type="module" src="/host.js"></script></body></html>', { headers: { 'content-type': 'text/html' } })
  })
  const attempts: string[] = []
  const permissions: string[] = []
  const popups: string[] = []
  const server = createServer((request, response) => { attempts.push(request.url ?? ''); response.end('external') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: join(directory, 'preload.cjs') } })
  window.webContents.setWindowOpenHandler(({ url }) => { popups.push(url); return { action: 'deny' } })
  attachMcpAppFrameGuards(window.webContents, resources)
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (deniesMcpAppPermission(origin, details.requestingUrl, details.securityOrigin, details.embeddingOrigin)) permissions.push(`check-denied:${permission}`)
    return false
  })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (deniesMcpAppPermission(details.requestingUrl)) permissions.push(`request-denied:${permission}`)
    callback(false)
  })
  ipcMain.on('test:mcp-app-execute', (event, url: string) => { event.returnValue = resources.isActive(url, event.sender.id) })

  const html = `<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><h1>Security fixture</h1><script>
  window.fixtureState = { ready: false, result: null }; let nextId = 0; const pending = new Map();
  window.fixtureRequest = (method, params) => new Promise((resolve,reject) => { const id = nextId++; pending.set(id,{resolve,reject}); parent.postMessage({jsonrpc:'2.0',id,method,params},'*'); });
  window.addEventListener('message', e => { if(e.source!==parent)return; const m=e.data; if(m.id!==undefined && pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);} else if(m.method==='ui/resource-teardown'){parent.postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');} else if(m.method==='ui/notifications/tool-result'){fixtureState.result=m.params;} });
  fixtureRequest('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'security-fixture',version:'1'},appCapabilities:{}}).then(()=>{parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');fixtureState.ready=true;});
  </script></body></html>`
  const base: ToolAppAttachment = { appInstanceId: 'security', binding: { node: 'local', session: 'security', server: 'fixture', configGeneration: 1, configFingerprint: 'stable' }, resourceUri: 'ui://security/view', resource: { html, meta: { permissions: { camera: {} } }, hash: 'security' }, status: 'result', toolInput: {}, toolResult: { content: [{ type: 'text', text: 'Ready' }] } }
  // Only accessible to Playwright's main-process evaluator, never to an iframe.
  Object.assign(globalThis, { mcpSecurity: { resources, leaseSignals, window, base, attempts, internalAttempts, permissions, permissionsWithoutPolicy, popups, externalUrl: `http://127.0.0.1:${port}`, revokedChannel: MCP_APP_DOCUMENT_REVOKED } })
  app.on('before-quit', () => { server.close() })
  await window.loadURL('superone-renderer://app/index.html')
}
void start().catch(error => { console.error(error); app.exit(1) })
