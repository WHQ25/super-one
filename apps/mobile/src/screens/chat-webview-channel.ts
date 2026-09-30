/**
 * Authenticates messages from the chat document.
 *
 * Both platforms expose the native bridge to every frame of the WebView, not only to the
 * chat document: iOS registers `webkit.messageHandlers.ReactNativeWebView` in all frames and
 * Android injects `ReactNativeWebView` into every origin. A widget iframe could therefore post
 * `requestNative` (a plan approval, a resend, an open link) straight to RN. The chat document
 * proves itself with a per-document secret that RN delivers through `injectJavaScript`, which
 * only ever runs in the main frame; nested frames are cross-origin and cannot read it.
 *
 * Before the secret is issued only the document's boot messages pass: `ready` (which issues
 * it) and a fatal `error` from a document that failed to start.
 */
export interface ChatWebViewChannel {
  /** The raw message to hand on, or `null` when it did not come from the chat document. */
  receive(raw: string): string | null
  /** Call when the main frame starts loading a new document. */
  reset(): void
}

export function createChatWebViewChannel(deliver: (message: { type: 'channelToken'; token: string }) => void): ChatWebViewChannel {
  let token: string | null = null
  return {
    receive(raw) {
      let message: { type?: unknown; channel?: unknown }
      try {
        message = JSON.parse(raw) as typeof message
      } catch {
        return null
      }
      if (!message || typeof message !== 'object') return null
      if (token) return message.channel === token ? raw : null
      if (message.type === 'error') return raw
      if (message.type !== 'ready') return null
      token = channelToken()
      deliver({ type: 'channelToken', token })
      return raw
    },
    reset() {
      token = null
    },
  }
}

function channelToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
