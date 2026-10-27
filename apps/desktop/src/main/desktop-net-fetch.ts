import { net } from 'electron'

type NetFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Chromium's network stack follows the macOS system HTTP proxy. Node's
 * `fetch` does not. Resolve on each call: a test double that omits `net`
 * throws on access, and that must fall back to global `fetch` instead of
 * sticking.
 */
export function chromiumUsageFetch(): NetFetch | null {
  try {
    if (typeof net.fetch !== 'function') return null
    return (url, init) => net.fetch(url, init as Parameters<typeof net.fetch>[1]) as Promise<Response>
  } catch {
    return null
  }
}

/** Electron `net.fetch` when this process has it, otherwise global `fetch`. */
export function desktopNetFetch(url: string, init?: RequestInit): Promise<Response> {
  const impl = chromiumUsageFetch()
  if (!impl) return fetch(url, init)
  return impl(url, init ?? {})
}
