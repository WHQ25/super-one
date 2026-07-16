import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../browser/browser-automation-bridge', () => ({
  browserAutomationCall: vi.fn(),
}))

const gates = {
  cdp: false,
  cookies: false,
  mock: false,
  emulate: false,
}

vi.mock('../browser/browser-cdp', () => ({
  isCdpEnabled: () => gates.cdp,
  isCdpCookiesEnabled: () => gates.cdp && gates.cookies,
  isCdpMockEnabled: () => gates.cdp && gates.mock,
  isCdpEmulateEnabled: () => gates.cdp && gates.emulate,
  resolveCdpTarget: vi.fn(async () => 7),
  cdpScreenshot: vi.fn(),
  cdpClick: vi.fn(),
  cdpHover: vi.fn(),
  cdpDrag: vi.fn(),
  cdpPress: vi.fn(),
  cdpType: vi.fn(),
  cdpEmulate: vi.fn(),
  cdpGetCookies: vi.fn(async () => [{ name: 'a' }]),
  cdpSetFileInput: vi.fn(),
}))

vi.mock('../browser/browser-cdp-network', () => ({
  startRecording: vi.fn(async () => 'rec-1'),
  stopRecording: vi.fn(async () => []),
  waitForRecordedRequest: vi.fn(async () => null),
  getRecordedRequest: vi.fn(() => null),
  addMockRule: vi.fn(async () => {}),
  clearMockRules: vi.fn(async () => {}),
}))

vi.mock('../agent/browser-screenshot-store', () => ({
  persistScreenshot: vi.fn(() => '/tmp/shot.png'),
}))

vi.mock('../agent/browser-artifact-store', () => ({
  persistTextArtifact: vi.fn(() => '/tmp/art.json'),
}))

vi.mock('../browser/browser-download-tasks', () => ({
  startUrlDownloadTask: vi.fn(() => ({
    taskId: 'bdl_1',
    sessionId: 'sess-1',
    kind: 'url',
    status: 'running',
    backgrounded: false,
    startedAt: 1,
    url: 'https://x.test/a.png',
  })),
  raceDownloadTask: vi.fn(async () => ({
    mode: 'sync',
    settled: { ok: true, result: { path: '/tmp/dl/a.png', filename: 'a.png', bytes: 12, mimeType: 'image/png' } },
  })),
}))

vi.mock('../browser/browser-downloads', () => ({
  listDownloads: vi.fn(async () => []),
}))

import { decode as toonDecode } from '@toon-format/toon'
import {
  registerBrowserTools,
  BROWSER_TOOL_NAMES,
  getBrowserToolDescriptors,
  executeBrowserTool,
  isBrowserToolName,
  clearBrowserToolHandlers,
} from './browser-mcp-tools'
import { startRecording, stopRecording, waitForRecordedRequest, getRecordedRequest } from './../browser/browser-cdp-network'
import { browserAutomationCall } from '../browser/browser-automation-bridge'
import { cdpHover } from '../browser/browser-cdp'
import { startUrlDownloadTask, raceDownloadTask } from '../browser/browser-download-tasks'
import { listDownloads } from '../browser/browser-downloads'

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>

function buildTools(): Map<string, Handler> {
  const tools = new Map<string, Handler>()
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools.set(name, handler)
      return {}
    },
  }
  registerBrowserTools(server as never, 'sess-1')
  return tools
}

function resultText(reply: { content: Array<{ type: string; text?: string }> }): string {
  return reply.content.map((c) => c.text ?? '').join('')
}

describe('browser tool registration under experimental gates', () => {
  beforeEach(() => {
    gates.cdp = false
    gates.cookies = false
    gates.mock = false
    gates.emulate = false
    vi.clearAllMocks()
  })

  it('registers every browser tool even when all CDP settings are off', () => {
    const tools = buildTools()
    for (const name of BROWSER_TOOL_NAMES) {
      expect(tools.has(name), name).toBe(true)
    }
  })

  it('exports descriptors for every browser tool with object input schemas', () => {
    const descriptors = getBrowserToolDescriptors()
    expect(descriptors.map((d) => d.name).sort()).toEqual([...BROWSER_TOOL_NAMES].sort())
    for (const d of descriptors) {
      expect(d.description.length).toBeGreaterThan(0)
      expect(d.inputSchema).toMatchObject({ type: 'object' })
      expect(isBrowserToolName(d.name)).toBe(true)
    }
  })

  it('executes browser tools via the stdio-facing dispatcher', async () => {
    clearBrowserToolHandlers('sess-stdio')
    vi.mocked(browserAutomationCall).mockResolvedValueOnce({ ok: true, selector: '#x' })
    const reply = await executeBrowserTool('sess-stdio', 'browser_hover', { selector: '#x' })
    expect(reply.isError).not.toBe(true)
    expect(vi.mocked(browserAutomationCall)).toHaveBeenCalledWith(
      'sess-stdio',
      'hover',
      expect.objectContaining({ selector: '#x', engine: 'auto' }),
    )
  })

  it('rejects network recording with the CDP-required message when the master setting is off', async () => {
    const tools = buildTools()
    const reply = await tools.get('browser_network_start')!({})
    expect(reply.isError).toBe(true)
    expect(resultText(reply)).toContain('browser CDP setting')
  })

  it('rejects each experimental tool with a message naming its sub-setting when only CDP is on', async () => {
    gates.cdp = true
    const tools = buildTools()
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['browser_cookies', {}, 'cookie access'],
      ['browser_emulate', { reset: true }, 'device emulation'],
      ['browser_mock', { clear: true }, 'network mocking'],
    ]
    for (const [name, args, setting] of cases) {
      const reply = await tools.get(name)!(args)
      expect(reply.isError, name).toBe(true)
      expect(resultText(reply), name).toContain(setting)
    }
  })

  it('hovers via synthetic automation when CDP is off, and rejects a missing target', async () => {
    const tools = buildTools()
    vi.mocked(browserAutomationCall).mockResolvedValueOnce({ ok: true, selector: '#menu' })

    const ok = await tools.get('browser_hover')!({ selector: '#menu' })
    expect(ok.isError).toBeUndefined()
    expect(vi.mocked(browserAutomationCall)).toHaveBeenCalledWith('sess-1', 'hover', { selector: '#menu' })

    const bad = await tools.get('browser_hover')!({})
    expect(bad.isError).toBe(true)
    expect(resultText(bad)).toContain('exactly one')
  })

  it('hovers via a trusted CDP mouse move when CDP is on', async () => {
    gates.cdp = true
    const tools = buildTools()
    vi.mocked(browserAutomationCall).mockResolvedValueOnce({ ok: true, webContentsId: 7, x: 12, y: 34, selector: '#menu', name: 'Menu' })

    const reply = await tools.get('browser_hover')!({ selector: '#menu' })
    expect(reply.isError).toBeUndefined()
    expect(vi.mocked(browserAutomationCall)).toHaveBeenCalledWith('sess-1', 'resolvePoint', { selector: '#menu' })
    expect(vi.mocked(cdpHover)).toHaveBeenCalledWith(7, 12, 34)
  })

  it('resizes the viewport without CDP, resolving presets and rejecting empty input', async () => {
    const tools = buildTools()

    vi.mocked(browserAutomationCall).mockResolvedValue({ ok: true })
    await tools.get('browser_resize')!({ preset: 'mobile' })
    expect(vi.mocked(browserAutomationCall)).toHaveBeenLastCalledWith('sess-1', 'emulateViewport', { tab: undefined, width: 375, height: 812 })

    await tools.get('browser_resize')!({ width: 1440, height: 900 })
    expect(vi.mocked(browserAutomationCall)).toHaveBeenLastCalledWith('sess-1', 'emulateViewport', { tab: undefined, width: 1440, height: 900 })

    await tools.get('browser_resize')!({ reset: true })
    expect(vi.mocked(browserAutomationCall)).toHaveBeenLastCalledWith('sess-1', 'emulateViewport', { tab: undefined, reset: true })

    const bad = await tools.get('browser_resize')!({})
    expect(bad.isError).toBe(true)
    expect(resultText(bad)).toContain('preset')
  })

  it('records a scoped session, then collects and waits once CDP is enabled', async () => {
    gates.cdp = true
    const tools = buildTools()

    const start = await tools.get('browser_network_start')!({ match: '/api' })
    expect(start.isError).toBeUndefined()
    expect((toonDecode(resultText(start)) as Record<string, unknown>).recordingId).toBe('rec-1')
    expect(vi.mocked(startRecording)).toHaveBeenCalledWith(7, { match: '/api', resourceTypes: undefined, captureBodies: undefined, max: undefined })

    vi.mocked(stopRecording).mockResolvedValueOnce([{ requestId: 'r1', url: 'https://x.com/api', method: 'GET', status: 200, resourceType: 'Fetch', finished: true, body: 'y'.repeat(5000) }])
    const stop = await tools.get('browser_network_stop')!({ recordingId: 'rec-1' })
    expect(stop.isError).toBeUndefined()
    const stopData = toonDecode(resultText(stop)) as { count: number; requests: Array<Record<string, unknown>> }
    expect(stopData.count).toBe(1)
    expect(stopData.requests[0].url).toBe('https://x.com/api')
    // Manifest is a lean uniform row: size but NOT the body or headers (read on demand).
    expect(stopData.requests[0].bodyBytes).toBe(5000)
    expect(stopData.requests[0].body).toBeUndefined()
    expect(stopData.requests[0].requestHeaders).toBeUndefined()
    expect(vi.mocked(stopRecording)).toHaveBeenCalledWith('rec-1', undefined)

    const miss = await tools.get('browser_network_wait')!({ recordingId: 'rec-1', url: '/gone', timeoutMs: 1000 })
    expect(miss.isError).toBe(true)
    expect(resultText(miss)).toContain('/gone')
    expect(vi.mocked(waitForRecordedRequest)).toHaveBeenCalledWith('rec-1', '/gone', 1000)
  })

  it('reports a missing recording id from stop', async () => {
    const tools = buildTools()
    vi.mocked(stopRecording).mockResolvedValueOnce(null)
    const reply = await tools.get('browser_network_stop')!({ recordingId: 'nope' })
    expect(reply.isError).toBe(true)
    expect(resultText(reply)).toContain('nope')
  })

  it('reads one recorded request detail on demand: small inline, large spilled, missing errors', async () => {
    const tools = buildTools()

    vi.mocked(getRecordedRequest).mockReturnValueOnce({ requestId: 'r1', url: 'https://x.com/api', method: 'GET', status: 200, finished: true, requestHeaders: { accept: 'application/json' }, body: '{"ok":true}' })
    const small = await tools.get('browser_network_body')!({ recordingId: 'rec-1', requestId: 'r1' })
    const sd = toonDecode(resultText(small)) as Record<string, unknown>
    expect(sd.body).toBe('{"ok":true}')
    expect(sd.requestHeaders).toEqual({ accept: 'application/json' })
    expect(vi.mocked(getRecordedRequest)).toHaveBeenCalledWith('rec-1', 'r1')

    const big = 'x'.repeat(40_000)
    vi.mocked(getRecordedRequest).mockReturnValueOnce({ requestId: 'r2', url: 'https://x.com/api', method: 'POST', status: 200, finished: true, body: big })
    const large = await tools.get('browser_network_body')!({ recordingId: 'rec-1', requestId: 'r2' })
    const ld = toonDecode(resultText(large)) as Record<string, unknown>
    expect(ld.spilled).toBe(true)
    expect(ld.path).toBe('/tmp/art.json')
    expect(ld.bytes).toBe(40_000)
    expect(ld.body).toBeUndefined()

    vi.mocked(getRecordedRequest).mockReturnValueOnce(null)
    const miss = await tools.get('browser_network_body')!({ recordingId: 'rec-1', requestId: 'gone' })
    expect(miss.isError).toBe(true)
    expect(resultText(miss)).toContain('gone')
  })

  it('spills a large evaluate result but returns a small one inline', async () => {
    const tools = buildTools()

    vi.mocked(browserAutomationCall).mockResolvedValueOnce({ value: { title: 'ok' } })
    const small = await tools.get('browser_evaluate')!({ expression: 'x' })
    expect(JSON.parse(resultText(small))).toEqual({ value: { title: 'ok' } })

    vi.mocked(browserAutomationCall).mockResolvedValueOnce({ value: 'y'.repeat(40_000) })
    const large = await tools.get('browser_evaluate')!({ expression: 'x' })
    const data = JSON.parse(resultText(large))
    expect(data.spilled).toBe(true)
    expect(data.path).toBe('/tmp/art.json')
    expect(data.value).toBeUndefined()
  })
})

describe('browser_download', () => {
  beforeEach(() => {
    gates.cdp = false
    vi.clearAllMocks()
    vi.mocked(raceDownloadTask).mockResolvedValue({
      mode: 'sync',
      settled: { ok: true, result: { path: '/tmp/dl/a.png', filename: 'a.png', bytes: 12, mimeType: 'image/png' } },
    })
  })

  it('starts a url task and returns the path when it finishes within timeout', async () => {
    const tools = buildTools()
    const reply = await tools.get('browser_download')!({ url: 'https://x.test/a.png', timeoutMs: 15000 })

    expect(startUrlDownloadTask).toHaveBeenCalledWith('sess-1', 'https://x.test/a.png', undefined)
    expect(raceDownloadTask).toHaveBeenCalledWith('bdl_1', 15000)
    expect(reply.isError).toBeUndefined()
    expect(JSON.parse(resultText(reply))).toMatchObject({ status: 'completed', path: '/tmp/dl/a.png', filename: 'a.png' })
  })

  it('returns background status with taskId when the download exceeds timeout', async () => {
    vi.mocked(raceDownloadTask).mockResolvedValueOnce({
      mode: 'background',
      task: {
        taskId: 'bdl_1',
        sessionId: 'sess-1',
        kind: 'url',
        status: 'running',
        backgrounded: true,
        startedAt: 1,
        url: 'https://x.test/a.png',
      },
    })
    const tools = buildTools()
    const reply = await tools.get('browser_download')!({ url: 'https://x.test/a.png', timeoutMs: 500 })

    expect(reply.isError).toBeUndefined()
    expect(JSON.parse(resultText(reply))).toMatchObject({ status: 'background', taskId: 'bdl_1' })
  })

  it('surfaces a failed download as a tool error', async () => {
    vi.mocked(raceDownloadTask).mockResolvedValueOnce({
      mode: 'sync',
      settled: { ok: false, error: 'HTTP 404 Not Found' },
    })
    const tools = buildTools()
    const reply = await tools.get('browser_download')!({ url: 'https://x.test/gone.png', timeoutMs: 15000 })

    expect(reply.isError).toBe(true)
    expect(resultText(reply)).toContain('HTTP 404')
  })
})

describe('browser_list_downloads', () => {
  beforeEach(() => {
    gates.cdp = false
    vi.clearAllMocks()
  })

  it('returns the session capture list', async () => {
    vi.mocked(listDownloads).mockResolvedValueOnce([
      {
        url: 'https://x.test/export.csv',
        filename: 'export.csv',
        path: '/tmp/dl/export.csv',
        bytes: 90,
        state: 'completed',
        startedAt: 2,
      },
    ])
    const tools = buildTools()
    const reply = await tools.get('browser_list_downloads')!({ state: 'all', wait: false, timeoutMs: 15000 })

    expect(listDownloads).toHaveBeenCalledWith('sess-1', { state: 'all', wait: false, timeoutMs: 15000 })
    expect(JSON.parse(resultText(reply))).toMatchObject({
      count: 1,
      downloads: [{ filename: 'export.csv', state: 'completed' }],
    })
  })
})
