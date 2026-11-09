import WebSocket from 'ws'
import {
  DOUBAO_REALTIME_URL,
  doubaoConnectionHeaders,
  readDoubaoHandshakeFailure,
  redactDoubaoText,
} from '@superone/shared/doubao-realtime'

export interface DoubaoSocket {
  send(data: string): void
  close(): void
  onMessage(listener: (text: string) => void): void
  onClose(listener: (error?: Error) => void): void
}

export interface DoubaoConnection {
  socket: DoubaoSocket
  logid?: string
}

/** Node `ws` so a rejected upgrade keeps its HTTP status and body. */
export function connectDoubaoSocket(apiKey: string): Promise<DoubaoConnection> {
  return new Promise((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(DOUBAO_REALTIME_URL, {
      headers: doubaoConnectionHeaders({ apiKey }),
      handshakeTimeout: 20_000,
    })
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
        const logid = header(response.headers['x-tt-logid'])
        const failure = readDoubaoHandshakeFailure(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'), logid)
        const detail = [failure.code, failure.message].filter(Boolean).join(' ')
        fail(new Error(redactDoubaoText(`Doubao handshake failed (${failure.status}${failure.logid ? `, ${failure.logid}` : ''}): ${detail}`)))
      })
    })
    let logid: string | undefined
    ws.on('error', error => fail(new Error(redactDoubaoText(error.message))))
    // `upgrade` is emitted before `open`. Keep the log id here so a fast `open` still records it.
    ws.on('upgrade', response => { logid = header(response.headers['x-tt-logid']) })
    ws.on('open', () => {
      if (settled) return
      settled = true
      resolve({ socket: wrap(ws), ...(logid ? { logid } : {}) })
    })
  })
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function wrap(ws: WebSocket): DoubaoSocket {
  return {
    send: data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    close: () => { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close() },
    onMessage: listener => ws.on('message', data => listener(String(data))),
    onClose: listener => {
      ws.on('close', () => listener())
      ws.on('error', error => listener(error instanceof Error ? error : new Error(String(error))))
    },
  }
}
