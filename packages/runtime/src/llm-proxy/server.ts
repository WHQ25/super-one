/**
 * In-process loopback LLM protocol proxy.
 *
 * Speaks Anthropic Messages (`/v1/messages`) and OpenAI Responses (`/responses`)
 * on the inbound side, and forwards to an OpenAI Chat Completions upstream.
 * No Electron, no @musistudio/llms.
 *
 * Inbound callers must present the harness placeholder key
 * (`PROXY_HARNESS_API_KEY` / `sk-superone-proxy`) via Authorization Bearer or
 * x-api-key. The real upstream secret never leaves this process.
 */

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ClaudeMessagesTransformer } from './claude-messages/transformer'
import { CodexResponsesTransformer } from './codex-responses/transformer'
import { PROXY_HARNESS_API_KEY } from './from-resolved'
import type { ProxyUpstream } from './types'

const MAX_BODY_BYTES = 32 * 1024 * 1024

/** Extract candidate inbound API key from harness-style headers. */
export function extractInboundApiKey(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)/i.exec(auth.trim())
    if (m?.[1]) return m[1]
  }
  const xApiKey = req.headers['x-api-key']
  if (typeof xApiKey === 'string' && xApiKey.trim()) return xApiKey.trim()
  if (Array.isArray(xApiKey) && typeof xApiKey[0] === 'string' && xApiKey[0].trim()) {
    return xApiKey[0].trim()
  }
  // Some OpenAI-compatible clients use api-key
  const apiKey = req.headers['api-key']
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim()
  return null
}

/** Timing-safe compare of inbound key to the harness placeholder. */
export function isAuthorizedInboundKey(presented: string | null, expected = PROXY_HARNESS_API_KEY): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function requireInboundAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (isAuthorizedInboundKey(extractInboundApiKey(req))) return true
  json(res, 401, {
    error: {
      message: 'Unauthorized: present Authorization: Bearer sk-superone-proxy (or x-api-key)',
      type: 'authentication_error',
    },
  })
  return false
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function pathnameOf(url: string | undefined): string {
  if (!url) return '/'
  try {
    return new URL(url, 'http://127.0.0.1').pathname
  } catch {
    return url.split('?')[0] || '/'
  }
}

async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status
  web.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'transfer-encoding' || lower === 'content-length') return
    res.setHeader(key, value)
  })

  if (!web.body) {
    res.end()
    return
  }

  const reader = web.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once('drain', resolve))
        }
      }
    }
  } finally {
    reader.releaseLock()
    res.end()
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

export interface LlmProxyServer {
  port: number
  url: string
  close(): Promise<void>
}

export async function startLlmProxyServer(upstream: ProxyUpstream, port: number): Promise<LlmProxyServer> {
  const claude = new ClaudeMessagesTransformer({
    providerName: upstream.name,
    apiBaseUrl: upstream.api_base_url,
    apiKey: upstream.api_key,
  })
  const codex = new CodexResponsesTransformer({
    apiBaseUrl: upstream.api_base_url,
    apiKey: upstream.api_key,
    reasoningConfig: upstream.reasoningConfig,
    providerName: upstream.name,
  })

  const modelsPayload = {
    object: 'list',
    data: (upstream.models ?? []).map((id) => ({ id, object: 'model' })),
  }
  const codexModelsPayload = { models: (upstream.models ?? []).map((id) => ({ id })) }

  const server: Server = createServer(async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      const path = pathnameOf(req.url)

      // Liveness only — no secrets, no spend. Keep unauthenticated for probes.
      if (method === 'GET' && (path === '/health' || path === '/')) {
        json(res, 200, { ok: true })
        return
      }

      // Everything that can spend quota or leak model lists requires the
      // harness placeholder key (same value injected as ANTHROPIC_*/OPENAI_*/CODEX_*).
      if (!requireInboundAuth(req, res)) return

      if (method === 'GET' && (path === '/v1/models' || path === '/models')) {
        json(res, 200, path === '/models' ? codexModelsPayload : modelsPayload)
        return
      }

      if (method === 'POST' && (path === '/v1/messages' || path === '/messages')) {
        const raw = await readBody(req)
        const webReq = new Request(`http://127.0.0.1${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        })
        const webRes = await claude.forward(webReq)
        await writeWebResponse(res, webRes)
        return
      }

      if (
        method === 'POST' &&
        (path === '/responses' ||
          path === '/v1/responses' ||
          path === '/responses/compact' ||
          path === '/v1/responses/compact')
      ) {
        const raw = await readBody(req)
        const webReq = new Request(`http://127.0.0.1${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
        })
        const webRes = await codex.forward(webReq)
        await writeWebResponse(res, webRes)
        return
      }

      json(res, 404, { error: { message: `not found: ${method} ${path}`, type: 'not_found' } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        json(res, 500, { error: { message, type: 'proxy_error' } })
      } else {
        res.end()
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
