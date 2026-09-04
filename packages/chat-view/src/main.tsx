import { createRoot } from 'react-dom/client'
import { ChatView, ChatViewErrorBoundary } from './ChatView'
import { initializeChatViewI18n } from './i18n'
import './theme.css'

// Brand hue is present before the first React paint; setTheme can override it later.
document.documentElement.style.setProperty('--brand-hue', '250')
document.documentElement.classList.add('dark')

async function start(): Promise<void> {
  await initializeChatViewI18n('en')
  const root = document.getElementById('root')
  if (!root) throw new Error('chat-view root element is missing')
  createRoot(root).render(
    <ChatViewErrorBoundary>
      <ChatView />
    </ChatViewErrorBoundary>,
  )
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  document.body.innerHTML = '<pre class="chat-view-fatal"></pre>'
  const fatal = document.querySelector('.chat-view-fatal')
  if (fatal) fatal.textContent = message
  const bridge = globalThis as typeof globalThis & {
    ReactNativeWebView?: { postMessage(message: string): void }
  }
  bridge.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'error', fatal: true, message }))
})
