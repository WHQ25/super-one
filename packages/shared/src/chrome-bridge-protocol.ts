export const CHROME_NATIVE_HOST_BASE = 'com.superone.browser_bridge'

export type ChromeBridgeVariant = 'stable' | 'alpha' | 'dev'

export const CHROME_BRIDGE_VARIANTS: readonly ChromeBridgeVariant[] = ['stable', 'alpha', 'dev']

/**
 * One unpacked extension per variant. Chrome's debugger banner shows the
 * extension name and cannot be changed while it is attached, so SuperOne,
 * SuperOne Alpha, and SuperOne Dev each have their own key and id.
 */
export const CHROME_EXTENSIONS: Record<ChromeBridgeVariant, { id: string; publicKey: string }> = {
  dev: {
    id: 'jofkjnmggjehenjccdmmpibcfjghpmfc',
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA++L30uAJWOxCN9zEhLDfUS9EbynpmPDlr8r10bFvcPzH3EgIfD8JWTiXS6P/TwKx88mYH/gGxFFiLPq+C0VaKH9ZXACnM8+f5e9brSiNPYBzKz3Lo34vC6H4LDm21hJYnSPCt5drZCvlG+d0g5V4+kqPizDldS5knYmlEeKCk7zBfJnb5CLxRmWp8sDzHuipnekl6jdYDSrva6eKMAgYtS4v090Yegbek0oe8P1F4AXNP1rqnpuVzrtoHdIhgSrbt2tvtGzdhlQbr9eiQpleQz2vGOew/RvHyIHTad1G0qVfXbEtESe3H16m6yE/j9+zzrZkOK/29tJGnRxX/oUtJwIDAQAB',
  },
  alpha: {
    id: 'cpedngcpmakmogafniadfblgpfkbkbib',
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArabhYo5Vw3FFYQuvbcDlzuwbB/Y6bBq6jmclCYBWcbvzmNymxTjLQHWsvp1r0U0XvvoOl+R+aHzdMIuOdrq6KH4ieREknJm8GdRiEMQiEB9M9XGqqnugdSMJ8d3eq+jC6U42XKKgfhqDarFN73eBn3XXaTB1Gdq26MHZSubvgYK+07zd0FdNZvR0qgkRUWQLM9szjyXHBXsuQz6sbKnisoG2sXRdAeKjtbH1mk9UpBRvySzbQgSUp2ihVt7Va9/xL4/tgmoErol+ZsRAHvRgqC+EaBm+kBhfHJlj0rS+rcxRRYeoclwsmoCQEE75ZdwLA9E87AJAN8gEQcsGlXiCiwIDAQAB',
  },
  stable: {
    id: 'gdmaoenofaebjmdljhkchmpbjddpokig',
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyMrcIzRK5+s5hhTSxSeOOnG34H707433bjz6TTYpbsxueDx71xCByr3NUyIc06jwsbSurIDtTZe+VsD1d7wuFDlkQi/s8Y2xFENsfWN8WsT6OAobsLi/paM3sWhBXdd3EZNAF2Km8ySzvoebL42WEFSpijtFTRM0HQ6FqDvgfxBMTr64z3va7GYBi6xcSRomkemu5XCb9sk7RcKBO5dMhoVhq4jeRjSiu/p+D2nP0gGTWQ0RUSmVnIixk6UuJIM6Y5MWkAEFQlTUcK7sJbvLXGt1z51vjE4b8WCOp7CTEomCWh9JuaWC4rvaBhn5AI2Khr7bwHDdZoNraKryCHU8NwIDAQAB',
  },
}

export const CHROME_EXTENSION_ID = CHROME_EXTENSIONS.dev.id

/** Public key baked into the dev extension so its id stays stable. */
export const CHROME_EXTENSION_PUBLIC_KEY = CHROME_EXTENSIONS.dev.publicKey

export function chromeExtensionIdentity(variant: ChromeBridgeVariant): { id: string; publicKey: string } {
  return CHROME_EXTENSIONS[variant]
}

/** Chrome's manifest version is at most four numeric components. */
export function chromeExtensionVersion(version: string): string {
  const numeric = version.split('-')[0] ?? ''
  const parts = numeric.split('.').filter((part) => /^\d+$/.test(part)).slice(0, 4)
  return parts.length > 0 ? parts.join('.') : '0'
}

/** Name Chrome shows on the debugger banner: product name plus app version. */
export function chromeExtensionLabel(productName: string, version: string): string {
  const name = productName.trim()
  const numeric = chromeExtensionVersion(version)
  return name ? `${name} ${numeric}` : numeric
}

export function chromeNativeHostName(variant: ChromeBridgeVariant): string {
  return variant === 'stable' ? CHROME_NATIVE_HOST_BASE : `${CHROME_NATIVE_HOST_BASE}.${variant}`
}

export const CHROME_TAB_PREFIX = 'chrome:'

export function isChromeTabId(tab: unknown): tab is string {
  return typeof tab === 'string' && tab.startsWith(CHROME_TAB_PREFIX)
}

/** `chrome:<tabId>` or, when the browser is known, `chrome:<browser>:<tabId>`. */
export function chromeTabRef(tabId: number, browser?: string): string {
  return browser ? `${CHROME_TAB_PREFIX}${browser}:${tabId}` : `${CHROME_TAB_PREFIX}${tabId}`
}

export function parseChromeTabRef(tab: string): number {
  return parseChromeTabTarget(tab).tabId
}

export function parseChromeTabTarget(tab: string): { browser?: string; tabId: number } {
  if (!isChromeTabId(tab)) throw new Error(`Invalid Chrome tab id: ${tab}`)
  const rest = tab.slice(CHROME_TAB_PREFIX.length)
  const colon = rest.indexOf(':')
  const browser = colon === -1 ? undefined : rest.slice(0, colon)
  const rawId = colon === -1 ? rest : rest.slice(colon + 1)
  const tabId = Number(rawId)
  if ((browser !== undefined && !/^[a-z0-9-]+$/.test(browser)) || !Number.isInteger(tabId) || tabId < 0) {
    throw new Error(`Invalid Chrome tab id: ${tab}`)
  }
  return browser ? { browser, tabId } : { tabId }
}

export type ChromeTabKind = 'shared' | 'agent'

export interface ChromeTabInfo {
  tabId: number
  url: string
  title: string
  loading: boolean
  active: boolean
  kind: ChromeTabKind
  owner?: string
}

export interface ChromeRecording {
  data: string
  mimeType: string
  durationMs: number
  width: number
  height: number
}

export interface ChromeBridgeMethods {
  'tabs.list': { params: Record<string, never>; result: { tabs: ChromeTabInfo[] } }
  'tabs.create': { params: { owner: string; url?: string }; result: ChromeTabInfo }
  'tabs.close': { params: { tabId: number }; result: { ok: true } }
  'tabs.navigate': {
    params: { tabId: number; url?: string; action?: 'back' | 'forward' | 'reload'; wait: boolean; timeoutMs?: number }
    result: ChromeTabInfo
  }
  'tabs.activate': { params: { tabId: number }; result: { ok: true } }
  'cdp.send': { params: { tabId: number; method: string; params?: object }; result: unknown }
  'cdp.detach': { params: { tabId: number }; result: { ok: true } }
  'record.start': { params: { tabId: number }; result: { recordingId: string } }
  'record.stop': { params: { tabId: number; recordingId: string }; result: ChromeRecording }
  'downloads.download': {
    params: { url: string; filename?: string }
    result: { path: string; filename: string; bytes: number; mimeType: string; state: 'completed' }
  }
}

export type ChromeBridgeMethod = keyof ChromeBridgeMethods

export interface ChromeBridgeEvents {
  hello: { version: string; extensionId: string }
  'tabs.changed': { tabs: ChromeTabInfo[] }
  'cdp.event': { tabId: number; method: string; params: unknown }
  'cdp.detached': { tabId: number; reason: string }
  'downloads.progress': {
    guid: string
    url: string
    filename: string
    path: string
    bytes: number
    state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
    tabId?: number
  }
}

export type ChromeBridgeEventName = keyof ChromeBridgeEvents

export interface ChromeBridgeRequest<M extends ChromeBridgeMethod = ChromeBridgeMethod> {
  id: number
  method: M
  params: ChromeBridgeMethods[M]['params']
}

export interface ChromeBridgeResponse {
  id: number
  result?: unknown
  error?: string
}

export interface ChromeBridgeEventMessage<E extends ChromeBridgeEventName = ChromeBridgeEventName> {
  event: E
  params: ChromeBridgeEvents[E]
}

export interface ChromeBridgeChunk {
  chunk: string
  index: number
  total: number
  data: string
}

export interface ChromeBridgeAuth {
  auth: string
  /** Catalog browser id. Absent or unknown must not take the Chrome slot. */
  browser?: string
}

export const CHROME_NATIVE_CHUNK_CHARS = 512 * 1024

export function isChromeBridgeChunk(value: unknown): value is ChromeBridgeChunk {
  const v = value as Partial<ChromeBridgeChunk> | null
  return !!v && typeof v.chunk === 'string' && typeof v.index === 'number' && typeof v.total === 'number' && typeof v.data === 'string'
}

export function splitChromeBridgeMessage(json: string, chunkId: string, size = CHROME_NATIVE_CHUNK_CHARS): string[] {
  if (json.length <= size) return [json]
  const total = Math.ceil(json.length / size)
  const parts: string[] = []
  for (let index = 0; index < total; index++) {
    const chunk: ChromeBridgeChunk = { chunk: chunkId, index, total, data: json.slice(index * size, (index + 1) * size) }
    parts.push(JSON.stringify(chunk))
  }
  return parts
}

export class ChromeBridgeChunkAssembler {
  private readonly pending = new Map<string, string[]>()

  accept(chunk: ChromeBridgeChunk): string | null {
    if (chunk.total < 1 || chunk.index < 0 || chunk.index >= chunk.total) return null
    let parts = this.pending.get(chunk.chunk)
    if (!parts) {
      parts = new Array<string>(chunk.total)
      this.pending.set(chunk.chunk, parts)
    }
    parts[chunk.index] = chunk.data
    for (let i = 0; i < chunk.total; i++) if (parts[i] === undefined) return null
    this.pending.delete(chunk.chunk)
    return parts.join('')
  }
}
