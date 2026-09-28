import { MEDIA_MIME, STREAMED_MEDIA_EXTS } from '../media-mime'
import type { Protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { Readable } from 'stream'
import { resolveRealPath } from '../path-security'
import { isMediaPathReadable } from '../media-readable-roots'
import { trace } from '../agent/event-trace'
import log from '../logger'
import { getAppBasePath, generateCSP, readManifest, validatePath } from './miniapp-service'
import { devServerOrigin, devServerSocketOrigin, fetchFromDevServer } from './miniapp-dev-server'

const LOCAL_FILE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json',
  wasm: 'application/wasm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
}

/** Headers a dev-server response keeps; the body arrives decoded, so its encoding and length do not apply. */
const DEV_SERVER_PASSTHROUGH_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified']

async function htmlCsp(basePath: string, hmrSocket?: string): Promise<string> {
  const manifest = await readManifest(basePath)
  return manifest ? generateCSP(manifest, hmrSocket) : "default-src 'none'"
}

async function serveFromDevServer(origin: string, url: URL, basePath: string): Promise<Response | null> {
  const upstream = await fetchFromDevServer(origin, url)
  if (!upstream) return null
  const headers = new Headers()
  for (const name of DEV_SERVER_PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // The manifest CSP still governs the page; only the HMR socket is added.
  if (headers.get('content-type')?.startsWith('text/html')) {
    headers.set('Content-Security-Policy', await htmlCsp(basePath, devServerSocketOrigin(origin)))
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}

const MINIAPP_MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
}

export function registerMiniAppProtocolHandlers(proto: Protocol): void {
  proto.handle('local-file', async (request) => {
    try {
      const origin = request.headers.get('origin') || ''
      if (origin.startsWith('superone-app://')) {
        return new Response('Forbidden', { status: 403 })
      }
      const rawPath = decodeURIComponent(new URL(request.url).pathname)
      const filePath = rawPath.replace(/^\/([A-Za-z]:)/, '$1')
      const resolved = resolveRealPath(filePath)
      if (!isMediaPathReadable(resolved)) {
        log.warn('[local-file] blocked path outside project folders:', resolved)
        return new Response('Forbidden', { status: 403 })
      }
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = MEDIA_MIME[`.${ext}`] ?? LOCAL_FILE_MIME[ext] ?? 'application/octet-stream'
      const range = request.headers.get('Range')

      // Video, audio and 3D models stream. readFile() loads the whole asset on
      // every request and can freeze the main process for large previews.
      if (STREAMED_MEDIA_EXTS.has(ext)) {
        let fileSize: number
        try { fileSize = statSync(resolved).size } catch {
          return new Response('Not found', { status: 404 })
        }
        log.debug(`[local-file] ${resolved} range=${range} size=${fileSize} stream=1`)
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/)
          const start = match ? parseInt(match[1], 10) : 0
          const end = match?.[2] ? parseInt(match[2], 10) : fileSize - 1
          const stream = createReadStream(resolved, { start, end })
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(end - start + 1),
              'Accept-Ranges': 'bytes',
            },
          })
        }
        return new Response(Readable.toWeb(createReadStream(resolved)) as ReadableStream, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(fileSize),
            'Accept-Ranges': 'bytes',
          },
        })
      }

      const data = await readFile(resolved)
      const total = data.byteLength
      log.debug(`[local-file] ${resolved} range=${range} size=${total}`)

      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/)
        const start = match ? parseInt(match[1]) : 0
        const end = match?.[2] ? parseInt(match[2]) : total - 1
        return new Response(data.subarray(start, end + 1), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
          },
        })
      }

      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch (err) {
      log.error('[local-file] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })

  proto.handle('superone-app', async (request) => {
    try {
      const url = new URL(request.url)
      const fullHost = url.hostname
      const dotIdx = fullHost.indexOf('.')
      const appId = dotIdx < 0 ? fullHost : fullHost.slice(0, dotIdx)
      const filePath = decodeURIComponent(url.pathname || '/index.html')

      const origin = request.headers.get('origin') || ''
      if (origin.startsWith('superone-app://') && origin !== `superone-app://${fullHost}`) {
        return new Response('Cross-app access forbidden', { status: 403 })
      }

      const basePath = getAppBasePath(appId)

      const devOrigin = await devServerOrigin(appId)
      if (devOrigin) {
        const served = await serveFromDevServer(devOrigin, url, basePath)
        if (served) return served
      }

      const resolved = validatePath(basePath, filePath === '/' ? '/index.html' : filePath)
      if (!resolved) {
        log.warn('[superone-app] path traversal blocked: %s %s', appId, filePath)
        return new Response('Forbidden', { status: 403 })
      }

      const data = await readFile(resolved)
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = MINIAPP_MIME[ext] ?? 'application/octet-stream'

      if (ext === 'html' || ext === 'htm') {
        const html = data.toString('utf-8')
        const standalone = url.searchParams.get('_standalone')
        if (standalone) {
          trace('miniapp.standalone', 'protocol-serve-html', {
            appId,
            filePath,
            callId: url.searchParams.get('_toolCallId') || '',
            toolName: url.searchParams.get('_toolName') || '',
            htmlBytes: data.byteLength,
          })
        }
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': await htmlCsp(basePath), 'Cache-Control': 'no-store' },
        })
      }

      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength), 'Cache-Control': 'no-store' },
      })
    } catch (err) {
      log.error('[superone-app] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })

}
