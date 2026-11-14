export type CdpMessageListener = (method: string, params: unknown) => void
export type CdpDetachListener = (reason: string) => void

export interface CdpTransport {
  send(method: string, params?: object): Promise<unknown>
  subscribe(listener: CdpMessageListener): () => void
  onDetach(listener: CdpDetachListener): () => void
}

/**
 * Electron webContents ids stay far below this. A Chrome target's internal id
 * is this plus Chrome's own tab id. Those tab ids already pass the base, so
 * the tab id itself is not limited by it.
 */
export const CHROME_TARGET_ID_BASE = 1_000_000_000

const transports = new Map<number, CdpTransport>()
let onForget: (webContentsId: number) => void = () => {}

/** browser-cdp registers this so a Chrome target drop clears domain refcounts. */
export function setCdpTargetForget(fn: (webContentsId: number) => void): void {
  onForget = fn
}

export function isChromeTargetId(webContentsId: number): boolean {
  return webContentsId >= CHROME_TARGET_ID_BASE
}

export function chromeTargetId(tabId: number): number {
  if (!Number.isInteger(tabId) || tabId < 0 || tabId > Number.MAX_SAFE_INTEGER - CHROME_TARGET_ID_BASE) {
    throw new Error(`Invalid Chrome tab id: ${tabId}`)
  }
  return CHROME_TARGET_ID_BASE + tabId
}

export function chromeTabIdFromTarget(webContentsId: number): number {
  if (!isChromeTargetId(webContentsId)) throw new Error('Not a Chrome tab')
  return webContentsId - CHROME_TARGET_ID_BASE
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
