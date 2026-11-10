import WebSocket from 'ws'
import { geminiLiveSocketUrl, redactGeminiText } from '@superone/shared/gemini-realtime'

export interface GeminiSocket {
  send(data: string): void
  close(): void
  onFrame(listener: (data: Buffer | string, isBinary: boolean) => void): void
  onClose(listener: (error?: Error) => void): void
}

/** Node `ws`. The API key stays in the URL and out of thrown messages. */
export function connectGeminiSocket(apiKey: string): Promise<GeminiSocket> {
  return new Promise((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(geminiLiveSocketUrl(apiKey), { handshakeTimeout: 20_000 })
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      ws.close()
      reject(error)
    }
    ws.on('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => {
        const body = redactGeminiText(Buffer.concat(chunks).toString('utf8'), apiKey).slice(0, 300)
        fail(new Error(`Gemini handshake failed (${response.statusCode ?? 0}): ${body}`))
      })
    })
    ws.on('error', error => fail(new Error(redactGeminiText(error.message, apiKey))))
    ws.on('open', () => {
      if (settled) return
      settled = true
      resolve(wrap(ws))
    })
  })
}

function wrap(ws: WebSocket): GeminiSocket {
  return {
    send: data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    close: () => { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close() },
    onFrame: listener => ws.on('message', (data, isBinary) => {
      if (typeof data === 'string') listener(data, isBinary)
      else if (Buffer.isBuffer(data)) listener(data, isBinary)
    }),
    onClose: listener => {
      ws.on('close', () => listener())
      ws.on('error', error => listener(error instanceof Error ? error : new Error(String(error))))
    },
  }
}
