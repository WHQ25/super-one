import { parseHostInbound, type HostInbound, type HostOutbound } from './protocol'
import type { ComposerViewRequest } from '@superone/shared/composer-view-bridge'
import type { SuperOneComposerOutcome } from '@superone/shared/composer-api'

interface WebViewGlobal extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

const browser = globalThis as unknown as WebViewGlobal

// The native bridge is reachable from every frame in the WebView, so the native host only
// trusts messages carrying the secret it injected into this document after `ready`. Boot
// messages go out before the secret exists; anything else waits for it.
let channel: string | undefined
let unsent: HostOutbound[] = []

export function postHost(message: HostOutbound): void {
  const native = browser.ReactNativeWebView
  if (native) {
    if (channel) native.postMessage(JSON.stringify({ ...message, channel }))
    else if (message.type === 'ready' || message.type === 'error') native.postMessage(JSON.stringify(message))
    else unsent.push(message)
    return
  }
  browser.parent?.postMessage(message, '*')
}

function openChannel(token: string): void {
  channel = token
  const queued = unsent
  unsent = []
  for (const message of queued) postHost(message)
}

export function requestNative(action: string, payload?: unknown): string {
  const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  postHost({ type: 'requestNative', requestId, action, payload })
  return requestId
}

const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
const pendingComposers = new Map<string, { viewId: string; resolve: (outcome: SuperOneComposerOutcome) => void; reject: (error: Error) => void }>()

/** Opening uses an ordinary short RPC; human input arrives through a dedicated native push. */
export function openNativeComposer(request: ComposerViewRequest & { messageId: string }): Promise<SuperOneComposerOutcome> {
  const key = `${request.viewId}:${request.localId}`
  if (pendingComposers.has(key)) return Promise.reject(new Error('This input request is already open'))
  if (pendingComposers.size >= 128) return Promise.reject(new Error('Too many pending input requests'))
  return new Promise((resolve, reject) => {
    pendingComposers.set(key, { viewId: request.viewId, resolve, reject })
    void requestNativeAsync('composerOpen', request).then(value => {
      const result = value as { ok?: boolean; requestId?: string; error?: { message?: string } } | undefined
      if (result?.ok !== true || !result.requestId) throw new Error(result?.error?.message ?? 'Could not open this input form')
    }).catch(error => {
      const pending = pendingComposers.get(key)
      pendingComposers.delete(key)
      pending?.reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export function releaseNativeComposer(viewId: string): void {
  try { requestNative('composerRelease', { viewId }) } catch { /* native host gone */ }
  for (const [key, pending] of pendingComposers) {
    if (pending.viewId !== viewId) continue
    pendingComposers.delete(key)
    pending.resolve({ status: 'cancelled', reason: 'owner_disposed' })
  }
}

export class NativeRequestTimeout extends Error {
  constructor() {
    super('Request timed out. Please try again.')
    this.name = 'NativeRequestTimeout'
  }
}

export function requestNativeAsync(action: string, payload?: unknown, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new NativeRequestTimeout())
    }, timeoutMs)
    pendingRequests.set(requestId, {
      resolve: value => { clearTimeout(timeout); resolve(value) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
    postHost({ type: 'requestNative', requestId, action, payload })
  })
}

export function installHostBridge(onMessage: (message: HostInbound) => void): () => void {
  let channelId: string | null = null
  let sequence = 0
  const retiredChannels = new Set<string>()
  const accept = (value: unknown): void => {
    const message = parseHostInbound(value)
    if (message?.type === 'channelToken') {
      if (typeof message.token === 'string' && message.token) openChannel(message.token)
      return
    }
    const delivery = message && 'delivery' in message ? message.delivery : undefined
    if (delivery) {
      if (retiredChannels.has(delivery.channelId)) return
      if (channelId !== delivery.channelId) {
        if (channelId) retiredChannels.add(channelId)
        channelId = delivery.channelId
        sequence = 0
      }
      if (delivery.sequence <= sequence) {
        // An ACK can be lost too. Receipt retries must never replay a hydrate.
        postHost({ type: 'transcriptApplied', ...delivery })
        return
      }
    }
    if (message?.type === 'nativeActionResult') {
      const pending = pendingRequests.get(message.requestId)
      pendingRequests.delete(message.requestId)
      if (message.error) pending?.reject(new Error(message.error))
      else pending?.resolve(message.result)
    }
    if (message?.type === 'composerSettled') {
      const key = `${message.viewId}:${message.localId}`
      const pending = pendingComposers.get(key)
      pendingComposers.delete(key)
      if (message.error) pending?.reject(new Error(message.error))
      else if (message.outcome) pending?.resolve(message.outcome)
      else pending?.reject(new Error('Invalid composer result'))
    }
    if (message) onMessage(message)
    if (delivery) {
      sequence = delivery.sequence
      postHost({ type: 'transcriptApplied', ...delivery })
    }
  }
  // Only the embedding host may speak through `message` events: a native dispatch has no
  // source, a browser host is `parent`. Frames inside the transcript (widgets) post from
  // their own window and must not be able to impersonate the host.
  const handleMessage = (event: MessageEvent): void => {
    if (event.source !== null && event.source !== browser.parent) return
    accept(event.data)
  }
  const handleDocumentMessage = (event: Event): void => {
    accept((event as MessageEvent).data)
  }

  browser.__applyHost = accept
  browser.addEventListener('message', handleMessage)
  document.addEventListener('message', handleDocumentMessage)

  return () => {
    for (const pending of pendingRequests.values()) pending.reject(new Error('Chat view disconnected'))
    pendingRequests.clear()
    for (const pending of pendingComposers.values()) pending.reject(new Error('Chat view disconnected'))
    pendingComposers.clear()
    if (browser.__applyHost === accept) delete browser.__applyHost
    browser.removeEventListener('message', handleMessage)
    document.removeEventListener('message', handleDocumentMessage)
  }
}
