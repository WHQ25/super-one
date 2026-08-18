import { webContents, type WebContents } from 'electron'
import { readAppSettings } from '../app-settings-service'
import { browserAutomationCall } from './browser-automation-bridge'
import log from '../logger'

export function isCdpEnabled(): boolean {
  return readAppSettings().cdpEnabled
}

export function isCdpCookiesEnabled(): boolean {
  const s = readAppSettings()
  return s.cdpEnabled && s.cdpCookiesEnabled
}

export function isCdpMockEnabled(): boolean {
  const s = readAppSettings()
  return s.cdpEnabled && s.cdpMockEnabled
}

export function isCdpEmulateEnabled(): boolean {
  const s = readAppSettings()
  return s.cdpEnabled && s.cdpEmulateEnabled
}

const attached = new Set<number>()

function ensureAttached(wc: WebContents): void {
  if (attached.has(wc.id) && wc.debugger.isAttached()) return
  if (!wc.debugger.isAttached()) {
    try {
      wc.debugger.attach('1.3')
    } catch (err) {
      throw new Error(
        `Failed to attach the debug protocol to this page — close its DevTools first if open. (${err instanceof Error ? err.message : String(err)})`,
      )
    }
    wc.debugger.on('detach', (_event, reason) => {
      attached.delete(wc.id)
      domainRefs.delete(wc.id)
      log.info('[browser-cdp] detached wc=%d reason=%s', wc.id, reason)
    })
    wc.once('destroyed', () => {
      attached.delete(wc.id)
      domainRefs.delete(wc.id)
    })
    wc.debugger
      .sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      .catch((err) => log.warn('[browser-cdp] focus emulation failed wc=%d %s', wc.id, err instanceof Error ? err.message : String(err)))
  }
  attached.add(wc.id)
}

function targetWebContents(webContentsId: number): WebContents {
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) throw new Error(`Browser view ${webContentsId} is not available`)
  return wc
}

export async function cdpSend<T = unknown>(webContentsId: number, method: string, params?: object): Promise<T> {
  const wc = targetWebContents(webContentsId)
  ensureAttached(wc)
  return wc.debugger.sendCommand(method, params) as Promise<T>
}

// A CDP domain is enabled per target, not per caller, so two features that both
// need one (network recording and perf measurement both need `Network`) must
// share a count — otherwise whichever stops first disables it under the other,
// and the survivor keeps running while silently receiving no events.
//
// The count alone is not enough: `enable` carries configuration (Network's
// buffer sizes). A later holder needing a richer config than the first one asked
// for must still get it, so the last applied args are tracked and a differing
// request re-enables. CDP `*.enable` is idempotent, so re-issuing is safe.
interface DomainState {
  count: number
  args?: object
}
const domainRefs = new Map<number, Map<string, DomainState>>()

export async function acquireDomain(webContentsId: number, domain: string, enableArgs?: object): Promise<void> {
  let perTarget = domainRefs.get(webContentsId)
  if (!perTarget) {
    perTarget = new Map()
    domainRefs.set(webContentsId, perTarget)
  }
  const previous = perTarget.get(domain)
  const argsChanged = enableArgs != null && JSON.stringify(enableArgs) !== JSON.stringify(previous?.args)
  const needsEnable = !previous || argsChanged
  perTarget.set(domain, { count: (previous?.count ?? 0) + 1, args: enableArgs ?? previous?.args })
  if (!needsEnable) return

  try {
    await cdpSend(webContentsId, `${domain}.enable`, enableArgs ?? {})
  } catch (err) {
    // Restore the prior state. A count left behind by a failed enable is never
    // released, so every later acquire would skip enable and its caller would
    // receive no events at all.
    if (previous) {
      perTarget.set(domain, previous)
    } else {
      perTarget.delete(domain)
      if (perTarget.size === 0) domainRefs.delete(webContentsId)
    }
    throw err
  }
}

export async function releaseDomain(webContentsId: number, domain: string): Promise<void> {
  const perTarget = domainRefs.get(webContentsId)
  const state = perTarget?.get(domain)
  if (!state || state.count === 0) return
  if (state.count > 1) {
    perTarget!.set(domain, { ...state, count: state.count - 1 })
    return
  }
  perTarget!.delete(domain)
  if (perTarget!.size === 0) domainRefs.delete(webContentsId)
  await cdpSend(webContentsId, `${domain}.disable`, {}).catch(() => {})
}

export function ensureAttachedById(webContentsId: number): WebContents {
  const wc = targetWebContents(webContentsId)
  ensureAttached(wc)
  return wc
}

export async function resolveCdpTarget(sessionId: string, tab?: string): Promise<number> {
  const res = (await browserAutomationCall(sessionId, 'resolveWebContentsId', { tab })) as { webContentsId?: number }
  if (typeof res?.webContentsId !== 'number' || res.webContentsId < 0) {
    throw new Error('Could not resolve the target browser view for CDP')
  }
  return res.webContentsId
}

interface Viewport {
  pageX?: number
  pageY?: number
  clientWidth: number
  clientHeight: number
}

interface LayoutMetrics {
  cssVisualViewport?: Viewport
  visualViewport?: Viewport
}

interface CaptureScreenshotResult {
  data: string
}

export interface CdpScreenshot {
  data: string
  width: number
  height: number
}

export interface CdpScreenshotOptions {
  selector?: string
}

async function boundingBox(webContentsId: number, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const evalRes = await cdpSend<{ result?: { value?: string } }>(webContentsId, 'Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }); })()`,
    returnByValue: true,
  })
  const raw = evalRes?.result?.value
  if (!raw) throw new Error('Screenshot selector did not resolve to a visible element')
  const box = JSON.parse(raw) as { x: number; y: number; width: number; height: number }
  if (box.width <= 0 || box.height <= 0) throw new Error('Screenshot selector did not resolve to a visible element')
  return box
}

export async function cdpScreenshot(webContentsId: number, options: CdpScreenshotOptions = {}): Promise<CdpScreenshot> {
  if (options.selector) {
    const box = await boundingBox(webContentsId, options.selector)
    const shot = await cdpSend<CaptureScreenshotResult>(webContentsId, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
    })
    return { data: shot.data, width: Math.round(box.width), height: Math.round(box.height) }
  }
  const metrics = await cdpSend<LayoutMetrics>(webContentsId, 'Page.getLayoutMetrics', {})
  const vp = metrics.cssVisualViewport ?? metrics.visualViewport
  if (!vp) throw new Error('Could not read page layout metrics for viewport screenshot')
  const width = Math.round(vp.clientWidth)
  const height = Math.round(vp.clientHeight)
  const shot = await cdpSend<CaptureScreenshotResult>(webContentsId, 'Page.captureScreenshot', {
    format: 'png',
    clip: { x: vp.pageX ?? 0, y: vp.pageY ?? 0, width, height, scale: 1 },
  })
  return { data: shot.data, width, height }
}

export async function cdpClick(webContentsId: number, x: number, y: number): Promise<void> {
  await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

export async function cdpHover(webContentsId: number, x: number, y: number): Promise<void> {
  await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface DragInterceptData {
  items: unknown[]
  files?: string[]
  dragOperationsMask: number
}

export interface DragOptions {
  steps?: number
  holdMs?: number
  humanize?: boolean
}

const STEP_MS = 16

export async function cdpDrag(webContentsId: number, fromX: number, fromY: number, toX: number, toY: number, opts: DragOptions = {}): Promise<void> {
  const wc = ensureAttachedById(webContentsId)
  const n = Math.max(1, Math.min(opts.steps ?? 10, 50))
  const hold = Math.max(0, Math.min(opts.holdMs ?? 0, 10_000))
  const humanize = opts.humanize === true
  const ease = (t: number): number => (humanize ? (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) : t)
  const stepDelay = (): number => (humanize ? STEP_MS * (0.5 + Math.random()) : STEP_MS)
  const pointAt = (i: number): { x: number; y: number } => {
    const p = i / n
    const t = ease(p)
    const amp = humanize ? 6 * (1 - p) : 0
    return { x: fromX + (toX - fromX) * t + (Math.random() * 2 - 1) * amp, y: fromY + (toY - fromY) * t + (Math.random() * 2 - 1) * amp }
  }
  let dragData: DragInterceptData | null = null
  const onMessage = (_event: unknown, method: string, params: unknown): void => {
    if (method === 'Input.dragIntercepted') dragData = (params as { data: DragInterceptData }).data
  }
  wc.debugger.on('message', onMessage)
  try {
    await cdpSend(webContentsId, 'Input.setInterceptDrags', { enabled: true }).catch(() => {})
    await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y: fromY })
    await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(STEP_MS)
    const first = pointAt(1)
    await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x, y: first.y, button: 'left', buttons: 1 })
    await sleep(Math.max(32, stepDelay()))
    if (dragData) {
      await cdpSend(webContentsId, 'Input.dispatchDragEvent', { type: 'dragEnter', x: toX, y: toY, data: dragData })
      await sleep(16)
      await cdpSend(webContentsId, 'Input.dispatchDragEvent', { type: 'dragOver', x: toX, y: toY, data: dragData })
      if (hold) await sleep(hold)
      await cdpSend(webContentsId, 'Input.dispatchDragEvent', { type: 'drop', x: toX, y: toY, data: dragData })
      await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 })
    } else {
      for (let i = 2; i <= n; i++) {
        const p = pointAt(i)
        await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 })
        await sleep(stepDelay())
      }
      if (hold) await sleep(hold)
      await cdpSend(webContentsId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 })
    }
  } finally {
    wc.debugger.off('message', onMessage)
    await cdpSend(webContentsId, 'Input.setInterceptDrags', { enabled: false }).catch(() => {})
  }
}

interface KeyDef {
  code: string
  keyCode: number
  text?: string
}

const NAMED_KEYS: Record<string, KeyDef> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
}

function keyDef(key: string): KeyDef {
  const named = NAMED_KEYS[key]
  if (named) return named
  if (key.length === 1) {
    const upper = key.toUpperCase()
    let code = ''
    if (upper >= 'A' && upper <= 'Z') code = `Key${upper}`
    else if (key >= '0' && key <= '9') code = `Digit${key}`
    return { code, keyCode: upper.charCodeAt(0), text: key }
  }
  return { code: '', keyCode: 0 }
}

const MOD_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

function modMask(mods: string[]): number {
  return mods.reduce((m, k) => m | (MOD_BITS[k] ?? 0), 0)
}

async function clickToFocus(webContentsId: number, selector: string): Promise<boolean> {
  const evalRes = await cdpSend<{ result?: { value?: string } }>(webContentsId, 'Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const b = el.getBoundingClientRect(); if (b.width <= 0 || b.height <= 0) return null; return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`,
    returnByValue: true,
  })
  const raw = evalRes?.result?.value
  if (!raw) return false
  const p = JSON.parse(raw) as { x: number; y: number }
  await cdpClick(webContentsId, p.x, p.y)
  return true
}

export async function cdpPress(webContentsId: number, key: string, modifiers: string[] = [], selector?: string): Promise<void> {
  if (selector && !(await clickToFocus(webContentsId, selector))) {
    throw new Error(`No element matches selector: ${selector}`)
  }
  const mods = modMask(modifiers)
  const def = keyDef(key)
  const isChar = mods === 0 && !!def.text
  const base = { modifiers: mods, key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode }
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', {
    type: isChar ? 'keyDown' : 'rawKeyDown',
    ...base,
    ...(isChar ? { text: def.text } : {}),
  })
  await cdpSend(webContentsId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

export async function cdpType(webContentsId: number, text: string, selector?: string, clear?: boolean): Promise<void> {
  // Do not call webContents.focus() — it steals keyboard focus from the host
  // composer when a background session types into a browser tab. Input is
  // routed through the guest debugger; setFocusEmulationEnabled (on attach)
  // keeps page-level focus semantics without host focus.
  if (selector && !(await clickToFocus(webContentsId, selector))) {
    throw new Error(`No element matches selector: ${selector}`)
  }
  const target = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.activeElement'
  const selectExisting = clear
    ? `if (field) { try { el.select(); } catch (e) {} } else if (el.isContentEditable) { const rg = document.createRange(); rg.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }`
    : `if (field) { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }`
  const focusExpr = `(() => { const el = ${target}; if (!el) return false; if (el.focus) el.focus(); const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'; ${selectExisting} return true; })()`
  const res = await cdpSend<{ result?: { value?: boolean } }>(webContentsId, 'Runtime.evaluate', { expression: focusExpr, returnByValue: true })
  if (!res?.result?.value) throw new Error('no input target')
  await cdpSend(webContentsId, 'Input.insertText', { text })
}

export interface EmulateOptions {
  width?: number
  height?: number
  deviceScaleFactor?: number
  mobile?: boolean
  userAgent?: string
  colorScheme?: 'light' | 'dark' | 'no-preference'
  timezone?: string
  locale?: string
  latitude?: number
  longitude?: number
  reset?: boolean
}

export async function cdpEmulate(webContentsId: number, o: EmulateOptions): Promise<void> {
  const clear = (method: string, params: object) => cdpSend(webContentsId, method, params).catch(() => {})
  if (o.reset) {
    const host = Intl.DateTimeFormat().resolvedOptions()
    await clear('Emulation.clearDeviceMetricsOverride', {})
    await clear('Emulation.setUserAgentOverride', { userAgent: '' })
    await clear('Emulation.setEmulatedMedia', { features: [] })
    await clear('Emulation.setTouchEmulationEnabled', { enabled: false })
    await clear('Emulation.setTimezoneOverride', { timezoneId: host.timeZone })
    await clear('Emulation.setLocaleOverride', { locale: host.locale })
    await clear('Emulation.clearGeolocationOverride', {})
    return
  }
  if (o.width != null && o.height != null) {
    await cdpSend(webContentsId, 'Emulation.setDeviceMetricsOverride', {
      width: o.width,
      height: o.height,
      deviceScaleFactor: o.deviceScaleFactor ?? 0,
      mobile: o.mobile ?? false,
    })
  }
  if (o.mobile != null) {
    await cdpSend(webContentsId, 'Emulation.setTouchEmulationEnabled', {
      enabled: o.mobile,
      ...(o.mobile ? { maxTouchPoints: 5 } : {}),
    }).catch(() => {})
  }
  if (o.userAgent != null) {
    await cdpSend(webContentsId, 'Emulation.setUserAgentOverride', {
      userAgent: o.userAgent,
      ...(o.locale ? { acceptLanguage: o.locale } : {}),
    })
  }
  if (o.colorScheme) {
    await cdpSend(webContentsId, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: o.colorScheme }],
    })
  }
  if (o.timezone) await cdpSend(webContentsId, 'Emulation.setTimezoneOverride', { timezoneId: o.timezone })
  if (o.locale) await cdpSend(webContentsId, 'Emulation.setLocaleOverride', { locale: o.locale }).catch(() => {})
  if (o.latitude != null && o.longitude != null) {
    await cdpSend(webContentsId, 'Emulation.setGeolocationOverride', { latitude: o.latitude, longitude: o.longitude, accuracy: 1 })
  }
}

interface RawCookie {
  name: string
  value: string
  domain: string
  path: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  expires?: number
}

const COOKIE_VALUE_CAP = 120

function projectCookie(c: RawCookie): Record<string, unknown> {
  const value = c.value ?? ''
  const truncated = value.length > COOKIE_VALUE_CAP
  return {
    name: c.name,
    value: truncated ? value.slice(0, COOKIE_VALUE_CAP) + '…' : value,
    ...(truncated ? { valueLength: value.length } : {}),
    domain: c.domain,
    path: c.path,
    ...(c.httpOnly ? { httpOnly: true } : {}),
    ...(c.secure ? { secure: true } : {}),
    ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    ...(c.expires != null && c.expires > 0 ? { expires: c.expires } : {}),
  }
}

export async function cdpGetCookies(webContentsId: number, urls?: string[]): Promise<unknown[]> {
  const res = await cdpSend<{ cookies?: RawCookie[] }>(webContentsId, 'Network.getCookies', urls ? { urls } : {})
  return (res.cookies ?? []).map(projectCookie)
}

export async function cdpSetFileInput(webContentsId: number, selector: string, files: string[]): Promise<void> {
  const evalRes = await cdpSend<{ result?: { objectId?: string } }>(webContentsId, 'Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
  })
  const objectId = evalRes?.result?.objectId
  if (!objectId) throw new Error(`No element matches selector: ${selector}`)
  await cdpSend(webContentsId, 'DOM.setFileInputFiles', { files, objectId })
}

export function detachAllCdp(): void {
  for (const id of attached) {
    const wc = webContents.fromId(id)
    if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach()
      } catch {
        // already gone
      }
    }
  }
  attached.clear()
  // Detaching drops every domain subscription; a surviving count would make the
  // next acquire skip `enable` and deliver no events.
  domainRefs.clear()
}
