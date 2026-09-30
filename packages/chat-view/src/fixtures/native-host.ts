import { installHostBridge } from '../bridge'
import type { HostInbound } from '../protocol'

export interface FakeNativeRequest {
  requestId: string
  action: string
  payload?: Record<string, unknown>
}

export type FakeNativeReply = (body: { result?: unknown; error?: string }) => void

type NativeWindow = typeof globalThis & {
  ReactNativeWebView?: { postMessage(raw: string): void }
  __applyHost?: (message: unknown) => void
}

/**
 * Stands in for the RN shell in stories and tests: installs the bridge, opens its message
 * channel the way the shell does after `ready`, and hands each native request to `respond`.
 */
export function installFakeNativeHost(
  respond: (request: FakeNativeRequest, reply: FakeNativeReply) => void,
  onHostMessage: (message: HostInbound) => void = () => {},
): () => void {
  const host = globalThis as NativeWindow
  const previous = host.ReactNativeWebView
  const uninstall = installHostBridge(onHostMessage)
  host.__applyHost?.({ type: 'channelToken', token: 'fake-native-host' })
  host.ReactNativeWebView = {
    postMessage(raw) {
      const message = JSON.parse(raw) as FakeNativeRequest & { type: string }
      if (message.type !== 'requestNative') return
      respond(message, (body) => host.__applyHost?.({ type: 'nativeActionResult', requestId: message.requestId, ...body }))
    },
  }
  return () => {
    uninstall()
    if (previous) host.ReactNativeWebView = previous
    else delete host.ReactNativeWebView
  }
}
