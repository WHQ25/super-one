import { markdownToHtml } from './markdown-html'
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from './markdown-worker'

interface PendingRequest {
  resolve: (html: string) => void
  reject: (err: unknown) => void
}

let sharedWorker: Worker | null = null
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null
  if (sharedWorker) return sharedWorker
  try {
    const worker = new Worker(new URL('./markdown-worker.ts', import.meta.url), {
      type: 'module',
      name: 'markdown-parse',
    })
    worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      const msg = event.data
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg.html)
      else entry.reject(new Error(msg.error))
    }
    worker.onerror = () => {
      workerFailed = true
      sharedWorker?.terminate()
      sharedWorker = null
      const entries = Array.from(pending.values())
      pending.clear()
      for (const entry of entries) {
        entry.reject(new Error('Markdown worker failed'))
      }
    }
    sharedWorker = worker
    return worker
  } catch {
    workerFailed = true
    return null
  }
}

export function parseMarkdownHtmlOffThread(markdown: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Markdown parse aborted', 'AbortError'))
  }
  if (!markdown.trim()) return Promise.resolve('')

  const worker = getWorker()
  if (!worker) return markdownToHtml(markdown)

  return new Promise<string>((resolve, reject) => {
    const id = nextRequestId++
    const onAbort = () => {
      pending.delete(id)
      reject(new DOMException('Markdown parse aborted', 'AbortError'))
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    pending.set(id, {
      resolve: (html) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(html)
      },
      reject: (err) => {
        signal?.removeEventListener('abort', onAbort)
        if (workerFailed && !signal?.aborted) {
          markdownToHtml(markdown).then(resolve, reject)
          return
        }
        reject(err)
      },
    })
    const req: MarkdownWorkerRequest = { id, markdown }
    worker.postMessage(req)
  })
}
