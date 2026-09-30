import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.fn()
const mockDevServerOrigin = vi.fn()
const mockFetchFromDevServer = vi.fn()

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../path-security', () => ({
  resolveRealPath: (p: string) => p,
  isPathWithinAllowed: () => true,
  getReadableAssetRoots: () => ['/projects'],
}))
vi.mock('../media-readable-roots', () => ({
  isMediaPathReadable: () => true,
}))
vi.mock('../session/session-repo', () => ({ listWorktreePaths: () => [] }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./miniapp-service', () => ({
  getAppBasePath: () => '/apps/demo',
  generateCSP: (_manifest: unknown, hmrSocket?: string) => `default-src 'self'${hmrSocket ? `; connect-src ${hmrSocket}` : ''}`,
  readManifest: async () => ({ appId: 'demo', name: 'Demo', main: 'node.js' }),
  validatePath: (base: string, p: string) => `${base}${p}`,
}))

vi.mock('./miniapp-dev-server', () => ({
  devServerOrigin: (appId: string) => mockDevServerOrigin(appId),
  fetchFromDevServer: (origin: string, url: URL) => mockFetchFromDevServer(origin, url),
  devServerSocketOrigin: (origin: string) => origin.replace(/^http:/, 'ws:'),
}))

import { registerMiniAppProtocolHandlers } from './miniapp-protocol'

type Handler = (request: Request) => Promise<Response>

function captureHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {}
  const proto = { handle: (scheme: string, fn: Handler) => { handlers[scheme] = fn } }
  registerMiniAppProtocolHandlers(proto as unknown as Parameters<typeof registerMiniAppProtocolHandlers>[0])
  return handlers
}

describe('miniapp protocol caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDevServerOrigin.mockResolvedValue(null)
  })

  it('serves superone-app HTML with no-store so upgrades are not cached', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('<html><head></head><body>v1</body></html>'))
    const handlers = captureHandlers()
    const res = await handlers['superone-app'](new Request('superone-app://demo.proj/index.html'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves superone-app static assets with no-store', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('console.log(1)'))
    const handlers = captureHandlers()
    const res = await handlers['superone-app'](new Request('superone-app://demo.proj/assets/index.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each(['origin', 'referer'])('refuses MCP App %s before reading local files or mini-app assets', async header => {
    const handlers = captureHandlers()
    const headers = { [header]: 'superone-mcp-app://isolated/views/one/index.html' }
    expect((await handlers['local-file'](new Request('local-file:///projects/private.txt', { headers }))).status).toBe(403)
    expect((await handlers['superone-app'](new Request('superone-app://demo/index.html', { headers }))).status).toBe(403)
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockFetchFromDevServer).not.toHaveBeenCalled()
  })
})

describe('miniapp protocol dev server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDevServerOrigin.mockResolvedValue('http://localhost:5310')
  })

  it('serves dev-server HTML under the manifest CSP plus the HMR socket', async () => {
    mockFetchFromDevServer.mockResolvedValue(new Response('<html>dev</html>', {
      headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': '999', 'Set-Cookie': 'a=1' },
    }))
    const res = await captureHandlers()['superone-app'](new Request('superone-app://demo.proj/index.html'))
    expect(await res.text()).toBe('<html>dev</html>')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'; connect-src ws://localhost:5310")
    expect(res.headers.get('Content-Encoding')).toBeNull()
    expect(res.headers.get('Content-Length')).toBeNull()
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('passes modules through without a CSP', async () => {
    mockFetchFromDevServer.mockResolvedValue(new Response('export {}', { headers: { 'Content-Type': 'text/javascript' } }))
    const res = await captureHandlers()['superone-app'](new Request('superone-app://demo.proj/src/main.tsx'))
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
  })

  it('falls back to the build when the dev server does not answer', async () => {
    mockFetchFromDevServer.mockResolvedValue(null)
    mockReadFile.mockResolvedValue(Buffer.from('<html><head></head><body>built</body></html>'))
    const res = await captureHandlers()['superone-app'](new Request('superone-app://demo.proj/index.html'))
    expect(await res.text()).toContain('built')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'")
  })
})
