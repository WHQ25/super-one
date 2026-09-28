import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockReadFile = vi.fn()
const mockLookup = vi.fn()
const mockBasePath = vi.fn()

vi.mock('fs/promises', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }))
vi.mock('./dev-registry', () => ({ lookupByAppId: (id: string) => mockLookup(id) }))
vi.mock('./miniapp-service', () => ({ getAppBasePath: (id: string) => mockBasePath(id) }))

import { devServerOrigin, reachableDevServer, fetchFromDevServer, devServerSocketOrigin } from './miniapp-dev-server'

const REG = { appId: 'demo', sourceDir: '/src/demo', distDir: '/src/demo/dist' }

function reportUrl(url: unknown) {
  mockReadFile.mockResolvedValue(JSON.stringify({ url }))
}

describe('devServerOrigin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLookup.mockResolvedValue(REG)
    mockBasePath.mockReturnValue(REG.distDir)
  })

  it('reads the address the dev server reported in the source directory', async () => {
    reportUrl('http://localhost:5310')
    expect(await devServerOrigin('demo')).toBe('http://localhost:5310')
    expect(mockReadFile).toHaveBeenCalledWith('/src/demo/.superone-dev-server.json', 'utf-8')
  })

  it('accepts every loopback host', async () => {
    for (const url of ['http://127.0.0.1:5173', 'http://[::1]:5173']) {
      reportUrl(url)
      expect(await devServerOrigin('demo')).toBe(url)
    }
  })

  it('ignores servers off this machine or over other schemes', async () => {
    for (const url of ['http://example.com:5173', 'http://192.168.1.2:5173', 'https://localhost:5173', 'file:///etc/passwd', 42]) {
      reportUrl(url)
      expect(await devServerOrigin('demo')).toBeNull()
    }
  })

  it('serves the build when nothing is reported or the report is malformed', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(await devServerOrigin('demo')).toBeNull()
    mockReadFile.mockResolvedValue('{not json')
    expect(await devServerOrigin('demo')).toBeNull()
  })

  it('does not apply to apps outside the dev registry', async () => {
    mockLookup.mockResolvedValue(undefined)
    expect(await devServerOrigin('demo')).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('does not apply to an installed copy of a registered app id', async () => {
    mockBasePath.mockReturnValue('/home/apps/demo')
    expect(await devServerOrigin('demo')).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
  })
})

describe('dev server requests', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockLookup.mockResolvedValue(REG)
    mockBasePath.mockReturnValue(REG.distDir)
    reportUrl('http://localhost:5310')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a server only while it answers', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null))
    expect(await reachableDevServer('demo')).toBe('http://localhost:5310')
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await reachableDevServer('demo')).toBeNull()
  })

  it('forwards the page path and query, mapping the root to index.html', async () => {
    fetchMock.mockResolvedValue(new Response('ok'))
    await fetchFromDevServer('http://localhost:5310', new URL('superone-app://demo.proj/card.html?_toolResult=1'))
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:5310/card.html?_toolResult=1', { redirect: 'manual' })
    await fetchFromDevServer('http://localhost:5310', new URL('superone-app://demo.proj/'))
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:5310/index.html', { redirect: 'manual' })
  })

  it('returns null when the server does not answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await fetchFromDevServer('http://localhost:5310', new URL('superone-app://demo.proj/index.html'))).toBeNull()
  })

  it('derives the HMR socket origin', () => {
    expect(devServerSocketOrigin('http://localhost:5310')).toBe('ws://localhost:5310')
  })
})
