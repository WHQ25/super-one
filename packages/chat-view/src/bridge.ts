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

export function installHostBridge(onMessage: (message: HostInbound) => void): () => void {
  const accept = (value: unknown): void => {
    const message = parseHostInbound(value)
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
    if (browser.__applyHost === accept) delete browser.__applyHost
    browser.removeEventListener('message', handleMessage)
    document.removeEventListener('message', handleDocumentMessage)
  }
}
