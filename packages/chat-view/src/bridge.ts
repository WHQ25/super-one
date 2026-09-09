import { parseHostInbound, type HostInbound, type HostOutbound } from './protocol'

interface WebViewGlobal extends Window {
  ReactNativeWebView?: { postMessage(message: string): void }
  __applyHost?: (message: unknown) => void
}

const browser = globalThis as unknown as WebViewGlobal

export function postHost(message: HostOutbound): void {
  if (browser.ReactNativeWebView) {
    browser.ReactNativeWebView.postMessage(JSON.stringify(message))
    return
  }
  browser.parent?.postMessage(message, '*')
}

export function requestNative(action: string, payload?: unknown): string {
  const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  postHost({ type: 'requestNative', requestId, action, payload })
  return requestId
}

const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

export function requestNativeAsync(action: string, payload?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Request timed out. Please try again.'))
    }, 30_000)
    pendingRequests.set(requestId, {
      resolve: value => { clearTimeout(timeout); resolve(value) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
    postHost({ type: 'requestNative', requestId, action, payload })
  })
}

export function installHostBridge(onMessage: (message: HostInbound) => void): () => void {
  const accept = (value: unknown): void => {
    const message = parseHostInbound(value)
    if (message?.type === 'nativeActionResult') {
      const pending = pendingRequests.get(message.requestId)
      pendingRequests.delete(message.requestId)
      if (message.error) pending?.reject(new Error(message.error))
      else pending?.resolve(message.result)
    }
    if (message) onMessage(message)
  }
  const handleMessage = (event: MessageEvent): void => accept(event.data)
  const handleDocumentMessage = (event: Event): void => {
    accept((event as MessageEvent).data)
  }

  browser.__applyHost = accept
  browser.addEventListener('message', handleMessage)
  document.addEventListener('message', handleDocumentMessage)

  return () => {
    for (const pending of pendingRequests.values()) pending.reject(new Error('Chat view disconnected'))
    pendingRequests.clear()
    if (browser.__applyHost === accept) delete browser.__applyHost
    browser.removeEventListener('message', handleMessage)
    document.removeEventListener('message', handleDocumentMessage)
  }
}
