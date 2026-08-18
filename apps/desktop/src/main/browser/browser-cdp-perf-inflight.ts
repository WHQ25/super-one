// Tracks which network requests are genuinely still working on behalf of the
// measured action.
//
// Naively counting "started minus finished" does not survive real pages: SSE
// streams, media, long-poll and keep-alive connections emit
// Network.requestWillBeSent and then never emit loadingFinished. Observed on
// threejs.org — four such requests pinned the count at 4 for a full 10s window,
// so the settle condition could never be met and every measurement degraded to
// a maxWait timeout.
//
// Two rules fix it, both about *provenance* rather than raw counting:
//   - a request opened before the action started belongs to the page, not the
//     action
//   - only requests positively identified as streaming are excluded. A finite
//     API call remains action work however long it takes; the outer maxWait then
//     reports a truthful timeout instead of silently declaring success.

const STREAMING_RESOURCE_TYPES = new Set(['eventsource', 'media', 'websocket'])

export function isStreamingResponse(
  resourceType?: string,
  mimeType?: string,
  headers?: Record<string, string | number>,
): boolean {
  if (STREAMING_RESOURCE_TYPES.has((resourceType ?? '').toLowerCase())) return true
  if ((mimeType ?? '').toLowerCase() === 'text/event-stream') return true
  const contentType = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]
  return String(contentType ?? '').toLowerCase().includes('text/event-stream')
}

interface OpenRequest {
  epoch: number
  streaming: boolean
  url?: string
}

export interface InFlightLedger {
  started(requestId: string, atMs: number, url?: string, resourceType?: string): void
  /** Marks a request as a proven long-lived stream after response metadata arrives. */
  markStreaming(requestId: string): void
  settled(requestId: string): void
  /** Non-streaming requests opened after the mark that are still working. */
  count(nowMs: number): number
  sawUrl(substring: string): boolean
  total(): number
  /** Action requests explicitly excluded because CDP identified them as streams. */
  streamingCount(): number
  /** Starts the action window: earlier requests and urls stop counting. */
  mark(atMs: number): void
}

export function createInFlightLedger(): InFlightLedger {
  const open = new Map<string, OpenRequest>()
  let settledUrls: string[] = []
  let total = 0
  let epoch = 0
  let streaming = 0

  return {
    started(requestId, _atMs, url, resourceType) {
      const isStreaming = isStreamingResponse(resourceType)
      open.set(requestId, { epoch, streaming: isStreaming, url })
      total += 1
      if (isStreaming) streaming += 1
    },
    markStreaming(requestId) {
      const request = open.get(requestId)
      if (!request || request.streaming || request.epoch !== epoch) return
      request.streaming = true
      streaming += 1
    },
    settled(requestId) {
      const request = open.get(requestId)
      if (request?.epoch === epoch && request.url) settledUrls.push(request.url)
      open.delete(requestId)
    },
    count(_nowMs) {
      let n = 0
      for (const request of open.values()) {
        if (request.epoch !== epoch || request.streaming) continue
        n += 1
      }
      return n
    },
    sawUrl: (substring) => settledUrls.some((u) => u.includes(substring)),
    total: () => total,
    streamingCount: () => streaming,
    mark(_atMs) {
      // Epochs make the boundary exact even when setup and mark happen inside
      // the same Date.now() millisecond.
      epoch += 1
      settledUrls = []
      total = 0
      streaming = 0
    },
  }
}
