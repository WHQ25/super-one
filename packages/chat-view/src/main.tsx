import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatMessage } from '@superone/shared/agent-types'

type HostInbound =
  | { type: 'hydrate'; messages: ChatMessage[] }
  | { type: 'applyReductionPatch'; messages?: ChatMessage[] }
  | { type: 'reset' }
  | { type: 'setTheme'; hue?: number }

function textOf(msg: ChatMessage): string {
  return msg.content
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_use') return `⚙ ${b.toolName}`
      if (b.type === 'thinking') return b.thinking ? `… ${b.thinking.slice(0, 80)}` : ''
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    const onMsg = (ev: MessageEvent<HostInbound>) => {
      const data = ev.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'hydrate' || data.type === 'applyReductionPatch') {
        if (data.messages) setMessages(data.messages)
      }
      if (data.type === 'reset') setMessages([])
      if (data.type === 'setTheme' && typeof data.hue === 'number') {
        document.documentElement.style.setProperty('--brand-hue', String(data.hue))
      }
    }
    window.addEventListener('message', onMsg)
    window.parent?.postMessage({ type: 'ready' }, '*')
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div style={{ padding: 16, paddingBottom: 48 }}>
      {messages.length === 0 ? <p style={{ color: '#71717a' }}>Waiting for session…</p> : null}
      {messages.map((m) => (
        <article key={m.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#a1a1aa' }}>{m.role}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{textOf(m)}</pre>
        </article>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
