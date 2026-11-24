import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { CustomScheme, Protocol } from 'electron'
import {
  enabledPlugins,
  packageDirForName,
  readPluginRegistry,
  resolveContainedFile,
} from '@superone/deepseek'
import { RENDERER_ORIGIN } from '../renderer-protocol'

export const PLUGIN_SCHEME = 'superone-plugin'

export const PLUGIN_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: PLUGIN_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
}

const PLUGIN_ASSET_MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const ALLOWED_PLUGIN_ASSET_EXTS = new Set(Object.keys(PLUGIN_ASSET_MIME))

export function resolveAllowedRendererOrigin(devRendererUrl = process.env['ELECTRON_RENDERER_URL']): string {
  if (devRendererUrl) {
    try {
      const parsed = new URL(devRendererUrl)
      return `${parsed.protocol}//${parsed.host}`
    } catch {
      return RENDERER_ORIGIN
    }
  }
  return RENDERER_ORIGIN
}

export function isAllowedPluginRequestOrigin(
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
  devRendererUrl = process.env['ELECTRON_RENDERER_URL'],
): string | null {
  const allowedOrigin = resolveAllowedRendererOrigin(devRendererUrl)
  if (originHeader) {
    if (originHeader === 'null' || originHeader !== allowedOrigin) return null
    return allowedOrigin
  }
  if (refererHeader) {
    try {
      const refUrl = new URL(refererHeader)
      const refOrigin = `${refUrl.protocol}//${refUrl.host}`
      if (refOrigin === allowedOrigin) return allowedOrigin
      if (refUrl.protocol === `${PLUGIN_SCHEME}:` && refUrl.host === 'pkg') {
        return allowedOrigin
      }
      return null
    } catch {
      return null
    }
  }
  return null
}

export function parsePluginAssetUrl(rawUrl: string): { pluginId: string; relPath: string } | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PLUGIN_SCHEME}:` || parsed.host !== 'pkg') return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  try {
    const pluginId = decodeURIComponent(segments[0]!)
    const relPath = segments.slice(1).map((seg) => decodeURIComponent(seg)).join('/')
    if (!pluginId || !relPath) return null
    return { pluginId, relPath }
  } catch {
    return null
  }
}

export function createPluginProtocolHandler(
  getPluginRoot: () => string,
  options?: { devRendererUrl?: () => string | undefined },
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }
    const devUrl = options?.devRendererUrl ? options.devRendererUrl() : process.env['ELECTRON_RENDERER_URL']
    const allowedOrigin = isAllowedPluginRequestOrigin(
      request.headers.get('origin'),
      request.headers.get('referer'),
      devUrl,
    )
    if (!allowedOrigin) {
      return new Response('Forbidden', { status: 403 })
    }

    const parsed = parsePluginAssetUrl(request.url)
    if (!parsed) {
      return new Response(null, { status: 404 })
    }

    const pluginRoot = getPluginRoot()
    const registry = await readPluginRegistry(pluginRoot)
    const row = enabledPlugins(registry).find((entry) => entry.id === parsed.pluginId)
    if (!row) {
      return new Response(null, { status: 404 })
    }

    const pkgDir = packageDirForName(pluginRoot, row.name)
    const resolved = await resolveContainedFile(pkgDir, parsed.relPath, ALLOWED_PLUGIN_ASSET_EXTS)
    if (!resolved) {
      return new Response(null, { status: 404 })
    }

    const mime = PLUGIN_ASSET_MIME[extname(resolved.normalized).toLowerCase()]
    if (!mime) {
      return new Response(null, { status: 404 })
    }

    let bytes: Buffer
    try {
      bytes = await readFile(resolved.absPath)
    } catch {
      return new Response(null, { status: 404 })
    }

    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': allowedOrigin,
        Vary: 'Origin',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}

export function registerPluginProtocol(proto: Protocol, getPluginRoot: () => string): void {
  proto.handle(PLUGIN_SCHEME, createPluginProtocolHandler(getPluginRoot))
}
