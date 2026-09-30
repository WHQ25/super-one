import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, Frame } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { McpAppResourceRegistry } from '../src/main/mcp-apps/protocol'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { BrowserWindow } from 'electron'

interface NativeState { resources: McpAppResourceRegistry; leaseSignals: Map<string, AbortSignal>; base: ToolAppAttachment; window: BrowserWindow; attempts: string[]; internalAttempts: string[]; permissions: string[]; permissionsWithoutPolicy: Set<string>; popups: string[]; externalUrl: string }
declare global { var mcpSecurity: NativeState }

test.describe('MCP App native iframe boundary', () => {
  let app: ElectronApplication
  let page: Page
  let temporary: string
  let externalUrl: string

  test.beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'superone-mcp-app-security-'))
    const profile = join(temporary, 'profile')
    await mkdir(profile)
    const build = (name: string, target: 'browser' | 'node', output: string) => execFileSync('bun', ['build', resolve(`e2e/fixtures/mcp-apps-security-${name}.ts`), '--target', target, '--format', target === 'node' ? 'cjs' : 'esm', '--external', 'electron', '--outfile', join(temporary, output)], { encoding: 'utf8' })
    build('main', 'node', 'main.cjs')
    build('preload', 'node', 'preload.cjs')
    build('host', 'browser', 'host.js')
    const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), MCP_APPS_SECURITY_BUILD: temporary, MCP_APPS_SECURITY_PROFILE: profile }
    // SuperOne's command process inherits Node mode; a real Electron launch must clear it.
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ args: [join(temporary, 'main.cjs')], env })
    page = await app.firstWindow()
    page.on('pageerror', error => console.error('[security renderer]', error.message))
    page.on('console', message => { if (message.type() === 'error') console.error('[security console]', message.text()) })
    await page.waitForURL('superone-renderer://app/index.html')
    await page.reload()
    await page.waitForFunction(() => Boolean(window.securityHarness))
    externalUrl = await app.evaluate(() => globalThis.mcpSecurity.externalUrl)
  })

  test.afterAll(async () => { await app?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }) })

  async function mount(session = 'security', nativePermissionProbe = false, strict = false): Promise<{ frame: Frame; url: string; id: string }> {
    const payload = await app.evaluate((_electron, input) => {
      const s = globalThis.mcpSecurity
      const fixture = { ...s.base, binding: { ...s.base.binding, session: input.session } }
      const scope = `local:${input.session}`
      const registration = s.resources.register(fixture, s.window.webContents.id, s.window.webContents.getURL(), scope)
      s.leaseSignals.set(registration.id, s.resources.lease(registration.id, s.window.webContents.id, scope, fixture.appInstanceId).signal)
      if (input.nativePermissionProbe) s.permissionsWithoutPolicy.add(registration.url)
      return { app: fixture, ...registration, nativePermissionProbe: input.nativePermissionProbe }
    }, { session, nativePermissionProbe })
    await page.evaluate(async input => { await window.securityHarness.mount(input.app, input.url, input.origin, input.nativePermissionProbe, input.strict) }, { ...payload, strict })
    await expect.poll(async () => page.evaluate(() => window.securityHarness.state.loads)).toBe(1)
    const frame = page.frames().find(frame => frame.url() === payload.url)!
    expect(frame).toBeTruthy()
    await frame.waitForFunction(() => (window as unknown as { fixtureState: { ready: boolean } }).fixtureState?.ready)
    return { frame, url: payload.url, id: payload.id }
  }

  test('initial real document loads once, is cross-origin and has no native API', async () => {
    const { frame } = await mount()
    expect(await page.locator('#mcp-view').getAttribute('allow')).toBe('')
    expect(await page.evaluate(() => window.securityHarness.state.revoked)).toBe(false)
    const result = await frame.evaluate(() => {
      let parentError = ''
      try { void parent.document.body } catch (error) { parentError = (error as Error).name }
      return { parentError, native: typeof window.securityNative, require: typeof (window as unknown as { require?: unknown }).require }
    })
    expect(result).toEqual({ parentError: 'SecurityError', native: 'undefined', require: 'undefined' })
  })

  test('sandbox blocks top navigation/popups and header CSP blocks forms/network', async () => {
    const { frame } = await mount()
    const result = await frame.evaluate(async target => {
      let topError = ''
      try { top!.location.href = `${target}/top` } catch (error) { topError = (error as Error).name }
      const popup = window.open(`${target}/popup`)
      const form = document.createElement('form'); form.action = `${target}/form`; form.method = 'POST'; document.body.appendChild(form); form.submit()
      let fetchError = ''
      try { await fetch(`${target}/fetch`) } catch (error) { fetchError = (error as Error).name }
      return { topError, popup: popup === null, fetchError }
    }, externalUrl)
    expect(result).toEqual({ topError: 'SecurityError', popup: true, fetchError: 'TypeError' })
    expect(page.url()).toBe('superone-renderer://app/index.html')
    expect(await app.evaluate(() => globalThis.mcpSecurity.attempts)).toEqual([])
    expect(await app.evaluate(() => globalThis.mcpSecurity.popups)).toEqual([])
  })

  test('native cross-origin navigation is cancelled before an external request', async () => {
    const { frame, url, id } = await mount()
    await frame.evaluate(target => { location.href = `${target}/navigate?private=fixture` }, externalUrl)
    await expect.poll(async () => page.evaluate(() => window.securityHarness.state.revoked)).toBe(true)
    expect(frame.url()).toBe(url)
    expect(await app.evaluate(() => globalThis.mcpSecurity.attempts)).toEqual([])
    expect(await app.evaluate((_electron, original) => globalThis.mcpSecurity.resources.isActive(original), url)).toBe(false)
    expect(await app.evaluate((_electron, id) => globalThis.mcpSecurity.leaseSignals.get(id)?.aborted, id)).toBe(true)
  })

  test('no-referrer resource vectors never reach internal handlers, and noreferrer cannot open a popup', async () => {
    const { frame } = await mount('no-referrer')
    const result = await frame.evaluate(async external => {
      const blocked: string[] = []
      const violations: Array<{ uri: string; directive: string }> = []
      document.addEventListener('securitypolicyviolation', event => violations.push({ uri: event.blockedURI, directive: event.effectiveDirective }))
      const jobs: Promise<void>[] = []
      const targets = ['local-file://probe', 'superone-app://probe', 'superone-renderer://app', 'file:///tmp']
      for (const base of targets) {
        for (const tag of ['img', 'script', 'link'] as const) jobs.push(new Promise<void>(resolve => {
          const element = document.createElement(tag)
          element.onerror = () => { blocked.push(`${base}:${tag}`); resolve() }
          element.onload = () => resolve()
          const url = `${base}/forbidden-${tag}`
          if (element instanceof HTMLLinkElement) { element.rel = 'stylesheet'; element.href = url }
          else element.src = url
          document.head.appendChild(element)
        }))
        jobs.push(fetch(`${base}/forbidden-fetch`, { mode: 'no-cors', referrerPolicy: 'no-referrer' }).then(() => {}, () => { blocked.push(`${base}:fetch`) }))
        const iframe = document.createElement('iframe'); iframe.src = `${base}/forbidden-iframe`; document.body.appendChild(iframe)
        try { const worker = new Worker(`${base}/forbidden-worker`); worker.onerror = () => blocked.push(`${base}:worker`); worker.terminate() } catch { blocked.push(`${base}:worker`) }
      }
      const popup = window.open(`${external}/no-referrer-popup`, '_blank', 'noreferrer')
      await Promise.all(jobs)
      // Violation events are delivered asynchronously after blocked resource errors.
      await new Promise(resolve => setTimeout(resolve, 50))
      return { blocked, violations, popupBlocked: popup === null, referrerPolicy: document.querySelector('meta[name="referrer"]')?.getAttribute('content'), reached: Boolean((window as unknown as { fixtureProbeReached?: boolean }).fixtureProbeReached) }
    }, externalUrl)
    expect(result.referrerPolicy).toBe('no-referrer')
    expect(result.blocked).toHaveLength(20)
    // file:// is denied by Chromium's local-resource boundary before CSP reports a violation.
    expect(result.violations.filter(value => value.directive === 'frame-src')).toHaveLength(3)
    expect(page.frames().some(value => value.url().startsWith('file://'))).toBe(false)
    expect(result.popupBlocked).toBe(true)
    expect(result.reached).toBe(false)
    expect(await app.evaluate(() => globalThis.mcpSecurity.internalAttempts)).toEqual([])
    expect(await app.evaluate(() => globalThis.mcpSecurity.attempts)).toEqual([])
    expect(await app.evaluate(() => globalThis.mcpSecurity.popups)).toEqual([])
  })

  test('same-document hash/history routing stays active; same-origin new document revokes', async () => {
    const { frame, url, id } = await mount()
    await frame.evaluate(() => { location.hash = 'page2'; history.pushState({}, '', '/route?page=2') })
    expect(await page.evaluate(() => window.securityHarness.state.revoked)).toBe(false)
    expect(await app.evaluate((_electron, id) => globalThis.mcpSecurity.leaseSignals.get(id)?.aborted, id)).toBe(false)
    await frame.evaluate(async () => { await (window as unknown as { fixtureRequest: (method: string, params: unknown) => Promise<unknown> }).fixtureRequest('tools/call', { name: 'fixture_next_page', arguments: {} }) })
    expect(await page.evaluate(() => window.securityHarness.state.calls)).toBe(1)
    const next = await app.evaluate(() => {
      const s = globalThis.mcpSecurity
      return s.resources.register(s.base, s.window.webContents.id, s.window.webContents.getURL()).url
    })
    await frame.evaluate(target => { location.href = target }, next)
    await expect.poll(async () => page.evaluate(() => window.securityHarness.state.loads)).toBe(2)
    expect(await page.evaluate(() => window.securityHarness.sameWindow())).toBe(true)
    expect(await page.evaluate(() => window.securityHarness.state.revoked)).toBe(true)
    await frame.evaluate(() => { parent.postMessage({ jsonrpc: '2.0', id: 777, method: 'tools/call', params: { name: 'fixture_next_page' } }, '*') })
    expect(await page.evaluate(() => window.securityHarness.state.calls)).toBe(1)
    expect(await app.evaluate((_electron, original) => globalThis.mcpSecurity.resources.isActive(original), url)).toBe(false)
    expect(await app.evaluate((_electron, id) => globalThis.mcpSecurity.leaseSignals.get(id)?.aborted, id)).toBe(true)
  })

  test('storage survives View replacement and is isolated across sessions', async () => {
    let { frame } = await mount('storage-one')
    await frame.evaluate(() => localStorage.setItem('private', 'first-session'))
    ;({ frame } = await mount('storage-one'))
    expect(await frame.evaluate(() => localStorage.getItem('private'))).toBe('first-session')
    ;({ frame } = await mount('storage-two'))
    expect(await frame.evaluate(() => localStorage.getItem('private'))).toBeNull()
  })

  test('declared camera permission has no iframe grant and Electron rejects access', async () => {
    const { frame } = await mount()
    expect(await page.locator('#mcp-view').getAttribute('allow')).toBe('')
    const result = await frame.evaluate(async () => {
      const camera = await navigator.permissions.query({ name: 'camera' as PermissionName })
      let errorName = ''
      try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()) } catch (error) { errorName = (error as Error).name }
      return { state: camera.state, errorName }
    })
    expect(result).toEqual({ state: 'denied', errorName: 'NotAllowedError' })
    // Header policy can deny before Electron's handler runs. Check that handler independently too.
    const probe = await mount('native-permission-probe', true)
    const nativeError = await probe.frame.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()); return 'granted' } catch (error) { return (error as Error).name }
    })
    expect(nativeError).toBe('NotAllowedError')
    expect(await app.evaluate(() => globalThis.mcpSecurity.permissions)).toContain('request-denied:media')
  })

  test('React StrictMode replays setup once and leaves exactly one live bridge', async () => {
    const { frame } = await mount('strict-mode', false, true)
    expect(await page.evaluate(() => ({ setups: window.securityHarness.state.setups, cleanups: window.securityHarness.state.cleanups }))).toEqual({ setups: 2, cleanups: 1 })
    await frame.evaluate(async () => { await (window as unknown as { fixtureRequest: (method: string, params: unknown) => Promise<unknown> }).fixtureRequest('tools/call', { name: 'fixture_next_page', arguments: {} }) })
    expect(await page.evaluate(() => window.securityHarness.state.calls)).toBe(1)
    expect(await page.evaluate(() => window.securityHarness.state.revoked)).toBe(false)
    expect(await page.evaluate(() => window.securityHarness.state.errors)).toEqual([])
  })
})
