import type { Protocol } from 'electron'
import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { resolveRealPath, isPathWithinAllowed, getReadableAssetRoots } from '../path-security'
import { getRecentFolders, getProjectPathById } from '../recent-folders'
import { listWorktreePaths } from '../session/session-repo'
import { getCurrentLocale } from '../i18n'
import { trace } from '../agent/event-trace'
import log from '../logger'
import { generateBridgeScript, generatePopoverBridgeScript, generateStandaloneBridgeScript, generateToolInterceptBridgeScript, generateToolResultBridgeScript, generateWorkerBridgeScript } from './miniapp-bridge'
import { getAppBasePath, generateCSP, readManifest, validatePath, getAllowedDirs, resolveSafePathMulti } from './miniapp-service'

const LOCAL_FILE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json',
  wasm: 'application/wasm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
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
      const folders = getRecentFolders()
      const worktrees = listWorktreePaths()
      const allowedRoots = getReadableAssetRoots([...folders.map((f) => f.path), ...worktrees])
      if (!isPathWithinAllowed(resolved, allowedRoots)) {
        log.warn('[local-file] blocked path outside project folders:', resolved)
        return new Response('Forbidden', { status: 403 })
      }
      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const contentType = LOCAL_FILE_MIME[ext] ?? 'application/octet-stream'
      const data = await readFile(resolved)
      const total = data.byteLength
      const range = request.headers.get('Range')
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
        const popoverName = url.searchParams.get('_popover')
        const toolIntercept = url.searchParams.get('_toolIntercept')
        const toolResult = url.searchParams.get('_toolResult')
        const standalone = url.searchParams.get('_standalone')
        const isWorker = url.searchParams.get('_worker')
        if (standalone) {
          trace('miniapp.standalone', 'protocol-serve-html', {
            appId,
            filePath,
            callId: url.searchParams.get('_toolCallId') || '',
            toolName: url.searchParams.get('_toolName') || '',
            htmlBytes: data.byteLength,
          })
        }
        const locale = getCurrentLocale()
        const bridgeScript = isWorker
          ? generateWorkerBridgeScript(appId, app.getVersion(), locale)
          : toolIntercept
          ? generateToolInterceptBridgeScript(appId, app.getVersion(), locale, {
              callId: url.searchParams.get('_toolCallId') || '',
              toolName: url.searchParams.get('_toolName') || '',
              initialData: JSON.parse(url.searchParams.get('_toolData') || 'null'),
            })
          : toolResult
            ? generateToolResultBridgeScript(appId, app.getVersion(), locale, {
                callId: url.searchParams.get('_toolCallId') || '',
                toolName: url.searchParams.get('_toolName') || '',
                result: JSON.parse(url.searchParams.get('_toolData') || 'null'),
              })
            : standalone
              ? generateStandaloneBridgeScript(appId, app.getVersion(), locale, {
                  callId: url.searchParams.get('_toolCallId') || '',
                  toolName: url.searchParams.get('_toolName') || '',
                })
              : popoverName
                ? generatePopoverBridgeScript(appId, app.getVersion(), locale, JSON.parse(url.searchParams.get('_popoverData') || 'null'))
                : generateBridgeScript(appId, app.getVersion(), locale)
        const injected = html.includes('<head>')
          ? html.replace('<head>', `<head>${bridgeScript}`)
          : html.includes('<html>')
            ? html.replace('<html>', `<html><head>${bridgeScript}</head>`)
            : bridgeScript + html
        const manifest = await readManifest(basePath)
        const csp = manifest ? generateCSP(manifest) : "default-src 'none'"
        return new Response(injected, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
        })
      }

      return new Response(data, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength) },
      })
    } catch (err) {
      log.error('[superone-app] failed:', err)
      return new Response('Not found', { status: 404 })
    }
  })

  proto.handle('superone-fs', async (request) => {
    try {
      const url = new URL(request.url)
      const fullHost = url.hostname
      const dotIdx = fullHost.indexOf('.')
      const appId = dotIdx < 0 ? fullHost : fullHost.slice(0, dotIdx)
      const projectId = dotIdx < 0 ? null : fullHost.slice(dotIdx + 1)
      const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (!relativePath) return new Response('Bad request', { status: 400 })

      const origin = request.headers.get('origin') || ''
      if (origin && origin !== 'null' && origin !== `superone-app://${fullHost}`) {
        return new Response('Forbidden', { status: 403 })
      }

      const projectDir = projectId ? getProjectPathById(projectId) : null
      if (!projectDir) return new Response('Unknown project', { status: 403 })

      const dirs = getAllowedDirs(projectDir, appId)
      if (!dirs?.length) return new Response('No allowed directories', { status: 403 })

      const { resolved, access: dirAccess } = resolveSafePathMulti(dirs, relativePath)

      if (request.method === 'GET') {
        const data = await readFile(resolved)
        const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
        const contentType = MINIAPP_MIME[ext] ?? 'application/octet-stream'
        return new Response(data, {
          headers: { 'Content-Type': contentType, 'Content-Length': String(data.byteLength) },
        })
      }

      if (request.method === 'PUT') {
        if (dirAccess === 'read') return new Response('Write access denied', { status: 403 })
        await mkdir(dirname(resolved), { recursive: true })
        const ct = request.headers.get('content-type') || ''
        if (ct.startsWith('text/') || ct.includes('json')) {
          const text = await request.text()
          await writeFile(resolved, text, 'utf-8')
        } else {
          const buf = Buffer.from(await request.arrayBuffer())
          await writeFile(resolved, buf)
        }
        return new Response(null, { status: 204 })
      }

      return new Response('Method not allowed', { status: 405 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('[superone-fs] failed:', err)
      if (msg.includes('Access denied') || msg.includes('not within allowed')) {
        return new Response(msg, { status: 403 })
      }
      return new Response(msg, { status: 500 })
    }
  })
}
