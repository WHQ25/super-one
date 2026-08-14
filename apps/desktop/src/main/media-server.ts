import { createServer, type Server } from 'http'
import { createReadStream, statSync } from 'fs'
import { extname } from 'path'
import { resolveRealPath, isPathWithinAllowed } from './path-security'
import { getMediaReadableRoots } from './media-readable-roots'
import log from './logger'

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.weba': 'audio/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
}

let server: Server | null = null
let port = 0

function getAllowedRoots(): string[] {
  return getMediaReadableRoots()
}

export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(port); return }

    server = createServer((req, res) => {
      if (!req.url) { res.writeHead(400).end(); return }
      const filePath = decodeURIComponent(req.url)
      const resolved = resolveRealPath(filePath)

      if (!isPathWithinAllowed(resolved, getAllowedRoots())) {
        log.warn('[media-server] blocked:', resolved)
        res.writeHead(403).end('Forbidden')
        return
      }

      const ext = extname(resolved).toLowerCase()
      const mime = MEDIA_MIME[ext]
      if (!mime) { res.writeHead(415).end('Unsupported media type'); return }

      let fileSize: number
      try { fileSize = statSync(resolved).size } catch {
        res.writeHead(404).end('Not found')
        return
      }

      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      }

      const range = req.headers.range
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        res.writeHead(206, {
          ...cors,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime,
        })
        createReadStream(resolved, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          ...cors,
          'Content-Length': fileSize,
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
        })
        createReadStream(resolved).pipe(res)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      port = typeof addr === 'object' ? addr!.port : 0
      log.info(`[media-server] listening on 127.0.0.1:${port}`)
      resolve(port)
    })

    server.on('error', reject)
  })
}

export function getMediaServerPort(): number {
  return port
}

export function stopMediaServer(): void {
  server?.close()
  server = null
  port = 0
}
