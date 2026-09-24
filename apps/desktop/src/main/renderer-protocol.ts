/**
 * Serves the built renderer from `superone-renderer://app/` instead of file://.
 *
 * Chromium keeps a V8 code cache only for http(s) and for schemes registered
 * with `codeCache`, so under file:// every launch re-parsed ~20MB of renderer
 * JS before first paint (~200ms of cold start). Development keeps the Vite
 * dev server, which is http and already cached.
 */
import { net, protocol, type BrowserWindow, type CustomScheme } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RENDERER_SCHEME = 'superone-renderer'
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app`

/** Passed to `protocol.registerSchemesAsPrivileged` before app ready. */
export const RENDERER_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: RENDERER_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
}

/** The file a renderer URL maps to under `root`, or null when it is not ours or escapes `root`. */
export function resolveRendererAsset(root: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (`${parsed.protocol}//${parsed.host}` !== RENDERER_ORIGIN) return null
  const file = resolve(root, `.${decodeURIComponent(parsed.pathname)}`)
  return file.startsWith(root + sep) ? file : null
}

export function registerRendererProtocol(root: string): void {
  const base = resolve(root)
  protocol.handle(RENDERER_SCHEME, (request) => {
    const file = resolveRendererAsset(base, request.url)
    if (!file || !existsSync(file)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

export function usesRendererDevServer(): boolean {
  return is.dev && Boolean(process.env['ELECTRON_RENDERER_URL'])
}

/** `search` includes its leading `?` when present. */
export function loadRendererPage(win: BrowserWindow, page: 'index.html' | 'bench.html', search = ''): Promise<void> {
  if (usesRendererDevServer()) {
    const path = page === 'index.html' ? '' : page
    return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${path}${search}`)
  }
  return win.loadURL(`${RENDERER_ORIGIN}/${page}${search}`)
}
