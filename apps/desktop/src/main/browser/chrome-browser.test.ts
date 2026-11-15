import { afterEach, describe, expect, it } from 'vitest'
import { chromeTabRef } from '@superone/shared/chrome-bridge-protocol'
import { ChromeBridgeHub } from './chrome-bridge-hub'
import { bindChromeBridge, chromeHostDownload, ownerDrivesChromeOnly, resetChromeBrowserForTests, tryChromeBrowserCall } from './chrome-browser'
import { chromePageDownloads, resetChromePageDownloadsForTests } from './chrome-download-feed'
import type { ChromeRendererDispatch } from './chrome-browser'
import { chromeBrowserFromTarget, chromeTabIdFromTarget, chromeTargetId } from './cdp-transport'
import { cdpSend } from './browser-cdp'

const shared = { tabId: 4, url: 'https://example.com', title: 'Example', loading: false, active: true, kind: 'shared' as const }
const agent = { tabId: 9, url: 'https://agent.example', title: 'Agent', loading: false, active: false, kind: 'agent' as const, owner: 'sess-a' }

function respondingHub(reply: (method: string, params: unknown) => unknown): ChromeBridgeHub {
  const hub = new ChromeBridgeHub()
  hub.attach((json) => {
    const request = JSON.parse(json) as { id: number; method: string; params: unknown }
    hub.receive(JSON.stringify({ id: request.id, result: reply(request.method, request.params) }))
  })
  return hub
}

function dispatch(embedded: Array<{ tab: string }>): ChromeRendererDispatch {
  return async (op) => {
    if (op === 'tabs') return { tabs: embedded }
    if (op === 'ownedWebContentsIds') return { webContentsIds: embedded.map((_tab, index) => index + 1) }
    return {}
  }
}

describe('chrome browser routing', () => {
  afterEach(() => {
    resetChromePageDownloadsForTests()
    resetChromeBrowserForTests()
  })

  it('leaves embedded tabs on the renderer when Chrome is not connected', async () => {
    const result = await tryChromeBrowserCall('sess-a', 'snapshot', { tab: 'browser-1' }, undefined, dispatch([]))
    expect(result).toEqual({ routed: false })
  })

  it('opens a Chrome tab when host is chrome', async () => {
    const seen: string[] = []
    const hub = respondingHub((method) => {
      seen.push(method)
      return { tabId: 9, url: 'about:blank', title: '', loading: false, active: false, kind: 'agent', owner: 'sess-a' }
    })
    bindChromeBridge(hub)
    const result = await tryChromeBrowserCall('sess-a', 'open', { host: 'chrome' }, undefined, dispatch([]))
    expect(seen).toEqual(['tabs.create'])
    expect(result).toEqual({ routed: true, result: { ok: true, tab: 'chrome:chrome:9', url: 'about:blank', title: '' } })
  })

  it('evaluates the shared snapshot script in a shared Chrome tab', async () => {
    let expression = ''
    const hub = respondingHub((method, params) => {
      if (method === 'cdp.send') {
        const body = params as { method: string; params?: { expression?: string } }
        if (body.method === 'Runtime.evaluate') expression = body.params?.expression ?? ''
        return { result: { value: { url: 'https://example.com', title: 'Example' } } }
      }
      return {}
    })
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }))
    const result = await tryChromeBrowserCall('sess-b', 'snapshot', { tab: chromeTabRef(4), include: ['meta'] }, undefined, dispatch([]))
    expect(expression).toContain('location.href')
    expect(result.routed).toBe(true)
    if (result.routed) expect(result.result).toMatchObject({ url: 'https://example.com' })
  })

  it('uses the only Chrome tab when the session has no embedded tab', async () => {
    const hub = respondingHub(() => ({ result: { value: { ok: true } } }))
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }))
    const result = await tryChromeBrowserCall('sess-a', 'click', { selector: 'button' }, undefined, dispatch([]))
    expect(result.routed).toBe(true)
  })

  it('asks for a tab when Chrome and an embedded tab are both open', async () => {
    const hub = respondingHub(() => ({}))
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }))
    await expect(tryChromeBrowserCall('sess-a', 'click', {}, undefined, dispatch([{ tab: 'browser-1' }]))).rejects.toThrow(/specify "tab"/)
  })

  it('refuses another session\'s agent tab and allows a shared tab', async () => {
    const hub = respondingHub(() => ({ result: { value: true } }))
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [agent, shared] } }))
    await expect(tryChromeBrowserCall('sess-b', 'click', { tab: 'chrome:9' }, undefined, dispatch([]))).rejects.toThrow(/not found/)
    const allowed = await tryChromeBrowserCall('sess-b', 'click', { tab: 'chrome:4' }, undefined, dispatch([]))
    expect(allowed.routed).toBe(true)
  })

  it('uses Chrome cookies only when no built-in browser tab is open', async () => {
    expect(await ownerDrivesChromeOnly('sess-a', dispatch([]))).toBe(false)
    const hub = respondingHub(() => ({}))
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared, agent] } }))
    expect(await ownerDrivesChromeOnly('sess-a', dispatch([]))).toBe(true)
    expect(await ownerDrivesChromeOnly('sess-b', dispatch([{ tab: 'browser-1' }]))).toBe(false)
  })

  it('downloads a URL through Chrome and returns the saved file', async () => {
    let seen: { method: string; params: unknown } | undefined
    const hub = respondingHub((method, params) => {
      seen = { method, params }
      return { path: '/Users/me/Downloads/a.txt', filename: 'a.txt', bytes: 4, mimeType: 'text/plain', state: 'completed' }
    })
    bindChromeBridge(hub)
    await expect(chromeHostDownload('https://x.test/a.txt', 'a.txt')).resolves.toEqual({
      path: '/Users/me/Downloads/a.txt',
      filename: 'a.txt',
      bytes: 4,
      mimeType: 'text/plain',
      state: 'completed',
    })
    expect(seen).toEqual({ method: 'downloads.download', params: { url: 'https://x.test/a.txt', filename: 'a.txt' } })
  })

  it('grants a finished page download from Chrome', () => {
    const hub = respondingHub(() => ({}))
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }))
    hub.receive(JSON.stringify({
      event: 'downloads.progress',
      params: {
        guid: 'g-page',
        url: 'https://example.com/a.txt',
        filename: 'a.txt',
        path: '/tmp/chrome-page-a.txt',
        bytes: 2,
        state: 'completed',
        tabId: 4,
      },
    }))
    expect(chromePageDownloads()[0]).toMatchObject({
      filename: 'a.txt',
      path: '/tmp/chrome-page-a.txt',
      state: 'completed',
      bytes: 2,
    })
  })

  it('drives a Chrome tab whose own id is already past the synthetic base', async () => {
    const tabId = 1_087_192_433
    let sentTab: number | undefined
    const hub = respondingHub((method, params) => {
      if (method === 'cdp.send') sentTab = (params as { tabId: number }).tabId
      return { result: { value: 'Gemini' } }
    })
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({
      event: 'tabs.changed',
      params: {
        tabs: [{
          tabId,
          url: 'https://gemini.google.com/app',
          title: 'Google Gemini',
          loading: false,
          active: true,
          kind: 'shared',
        }],
      },
    }))
    const result = await tryChromeBrowserCall(
      'sess-a',
      'evaluate',
      { tab: chromeTabRef(tabId), expression: 'document.title' },
      undefined,
      dispatch([]),
    )
    expect(chromeTabIdFromTarget(chromeTargetId(tabId))).toBe(tabId)
    expect(chromeTargetId(4)).toBe(1_000_000_000 + 4)
    expect(chromeBrowserFromTarget(chromeTargetId(4, 'edge'))).toBe('edge')
    expect(chromeTabIdFromTarget(chromeTargetId(4, 'edge'))).toBe(4)
    expect(chromeTargetId(4, 'edge')).toBeGreaterThan(chromeTargetId(4))
    expect(sentTab).toBe(tabId)
    expect(result).toEqual({ routed: true, result: { value: 'Gemini' } })
  })

  it('drives each connected browser on its own', async () => {
    const sent: string[] = []
    const hub = new ChromeBridgeHub()
    for (const browser of ['chrome', 'edge']) {
      hub.attach((json) => {
        const request = JSON.parse(json) as { id: number; method: string }
        sent.push(`${browser}:${request.method}`)
        hub.receive(JSON.stringify({
          id: request.id,
          result: { tabId: 4, url: 'about:blank', title: '', loading: false, active: false, kind: 'agent', owner: 'sess-a' },
        }), browser)
      }, browser)
    }
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }), 'chrome')
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [{ ...shared, url: 'https://edge.example' }] } }), 'edge')
    await expect(tryChromeBrowserCall('sess-a', 'open', { host: 'chrome' }, undefined, dispatch([]))).rejects.toThrow(/Pass browser/)
    const opened = await tryChromeBrowserCall('sess-a', 'open', { host: 'chrome', browser: 'edge' }, undefined, dispatch([]))
    expect(opened).toEqual({ routed: true, result: { ok: true, tab: 'chrome:edge:4', url: 'about:blank', title: '' } })
    await expect(tryChromeBrowserCall('sess-a', 'click', { tab: 'chrome:4' }, undefined, dispatch([]))).rejects.toThrow(/more than one browser/)
    const edge = await tryChromeBrowserCall('sess-a', 'focusView', { tab: 'chrome:edge:4' }, undefined, dispatch([]))
    expect(edge).toEqual({ routed: true, result: { ok: true } })
    expect(await ownerDrivesChromeOnly('sess-a', dispatch([]))).toBe(false)
    expect(sent).toContain('edge:tabs.create')
    expect(sent).toContain('edge:tabs.activate')
    expect(sent.filter((item) => item.startsWith('chrome:'))).toEqual([])
  })

  it('sends CDP for a Chrome target through the bridge', async () => {
    let method = ''
    const hub = respondingHub((name, params) => {
      method = name
      return { ok: true, params }
    })
    bindChromeBridge(hub)
    hub.receive(JSON.stringify({ event: 'tabs.changed', params: { tabs: [shared] } }))
    await tryChromeBrowserCall('sess-a', 'resolveWebContentsId', { tab: 'chrome:4' }, undefined, dispatch([]))
    const result = await cdpSend(chromeTargetId(4), 'Network.enable', {})
    expect(method).toBe('cdp.send')
    expect(result).toMatchObject({ ok: true })
  })
})
