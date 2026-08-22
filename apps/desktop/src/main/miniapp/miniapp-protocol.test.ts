import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.fn()

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
  getMediaReadableRoots: () => ['/projects', '/userData/media-gen'],
}))
vi.mock('../session/session-repo', () => ({ listWorktreePaths: () => [] }))
vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('./miniapp-service', () => ({
  getAppBasePath: () => '/apps/demo',
  generateCSP: () => "default-src 'self'",
  readManifest: async () => ({ appId: 'demo', name: 'Demo', main: 'node.js' }),
  validatePath: (base: string, p: string) => `${base}${p}`,
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
})
