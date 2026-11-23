import { markdownToHtml } from './markdown-html'

export interface MarkdownWorkerRequest {
  id: number
  markdown: string
}

export type MarkdownWorkerResponse =
  | { id: number; ok: true; html: string }
  | { id: number; ok: false; error: string }

self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest>) => {
  const { id, markdown } = event.data
  try {
    const html = await markdownToHtml(markdown)
    const response: MarkdownWorkerResponse = { id, ok: true, html }
    self.postMessage(response)
  } catch (err) {
    const response: MarkdownWorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}
