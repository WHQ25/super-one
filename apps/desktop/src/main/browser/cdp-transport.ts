export type CdpMessageListener = (method: string, params: unknown) => void
export type CdpDetachListener = (reason: string) => void

export interface CdpTransport {
  send(method: string, params?: object): Promise<unknown>
  subscribe(listener: CdpMessageListener): () => void
  onDetach(listener: CdpDetachListener): () => void
}

/**
 * Electron webContents ids stay far below this. A Chrome target's internal id
 * is this, plus one 2^32 slot per browser, plus Chrome's own tab id.
 * Slot 0 is Chrome, so `chromeTargetId(tabId)` stays `base + tabId`.
 */
export const CHROME_TARGET_ID_BASE = 1_000_000_000

/** Chrome tab ids are int32. One slot per browser keeps two tab 4s apart. */
export const CHROME_TARGET_ID_STRIDE = 2 ** 32

const CHROME_TARGET_SLOTS = ['chrome', 'chrome-beta', 'chrome-canary', 'chromium', 'edge', 'brave', 'arc', 'unknown'] as const

const transports = new Map<number, CdpTransport>()
let onForget: (webContentsId: number) => void = () => {}

/** browser-cdp registers this so a Chrome target drop clears domain refcounts. */
export function setCdpTargetForget(fn: (webContentsId: number) => void): void {
  onForget = fn
}

export function isChromeTargetId(webContentsId: number): boolean {
  return webContentsId >= CHROME_TARGET_ID_BASE
}

function chromeTargetSlot(browser: string): number {
  const index = CHROME_TARGET_SLOTS.indexOf(browser as (typeof CHROME_TARGET_SLOTS)[number])
  return index >= 0 ? index : CHROME_TARGET_SLOTS.indexOf('unknown')
}

export function chromeTargetId(tabId: number, browser = 'chrome'): number {
  if (!Number.isInteger(tabId) || tabId < 0 || tabId >= CHROME_TARGET_ID_STRIDE) {
    throw new Error(`Invalid Chrome tab id: ${tabId}`)
  }
  return CHROME_TARGET_ID_BASE + chromeTargetSlot(browser) * CHROME_TARGET_ID_STRIDE + tabId
}

export function chromeTabIdFromTarget(webContentsId: number): number {
  if (!isChromeTargetId(webContentsId)) throw new Error('Not a Chrome tab')
  return (webContentsId - CHROME_TARGET_ID_BASE) % CHROME_TARGET_ID_STRIDE
}

export function chromeBrowserFromTarget(webContentsId: number): string {
  if (!isChromeTargetId(webContentsId)) throw new Error('Not a Chrome tab')
  const slot = Math.floor((webContentsId - CHROME_TARGET_ID_BASE) / CHROME_TARGET_ID_STRIDE)
  return CHROME_TARGET_SLOTS[slot] ?? 'unknown'
}

export function registerCdpTransport(webContentsId: number, transport: CdpTransport): void {
  transports.set(webContentsId, transport)
}

export function unregisterCdpTransport(webContentsId: number): void {
  transports.delete(webContentsId)
  onForget(webContentsId)
}

export function cdpTransportFor(webContentsId: number): CdpTransport | null {
  return transports.get(webContentsId) ?? null
}
