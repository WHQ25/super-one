import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, Locale } from '@superone/shared/agent-types'
import { extendHistoryIndex } from '@superone/shared/session-history-index'
import { ChatView } from './ChatView'

function HistoryNavigationPreview({ state = 'ready', count = 100, scheme = 'light', locale = 'en' }: { state?: 'ready' | 'loading' | 'error' | 'jump-error' | 'page-loading'; count?: number; scheme?: 'light' | 'dark'; locale?: Locale }) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { ReactNativeWebView?: { postMessage(raw: string): void }; __applyHost?: (value: unknown) => void }
    const previous = host.ReactNativeWebView
    const rows: ChatMessage[] = Array.from({ length: count }, (_, index) => ({ id: `history-${index}`,
      role: index % 2 ? 'assistant' : 'user', providerId: 'claude', status: 'complete', createdAt: '',
      content: [{ type: 'text', text: index === 31 ? '__compact__:auto:1000' : `Message ${index + 1}\n\n${'Conversation content. '.repeat(20)}` }],
      ...(index === 31 ? { providerId: 'system' } : {}),
    }))
    const index = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, rows)
    let failed = false
    host.ReactNativeWebView = { postMessage(raw) {
      const request = JSON.parse(raw)
      if (request.type !== 'requestNative') return
      if (request.action === 'loadNavigationIndex' && state === 'loading') return
      // A page above or below the window stays in flight, so the "Load earlier"
      // button's own loading state — not the fixed pill — is what shows.
      if (request.action === 'loadHistoryWindow' && state === 'page-loading' && request.payload.direction !== 'around') return
      const error = !failed && (state === 'error' && request.action === 'loadNavigationIndex'
        || state === 'jump-error' && request.action === 'loadHistoryWindow')
      if (error) failed = true
      let result: unknown = index
      if (request.action === 'loadHistoryWindow') {
        const position = rows.findIndex(row => row.id === request.payload.anchorId)
        const direction = request.payload.direction
        const start = direction === 'before' ? Math.max(0, position - 8) : direction === 'after' ? position + 1 : Math.max(0, position - 2)
        result = { messages: rows.slice(start, direction === 'before' ? position : start + 8) }
      }
      queueMicrotask(() => host.__applyHost?.({ type: 'nativeActionResult', requestId: request.requestId,
        ...(error ? { error: 'Temporary history failure' } : { result }) }))
    } }
    host.__applyHost?.({ type: 'setTheme', scheme })
    host.__applyHost?.({ type: 'setViewport', locale })
    host.__applyHost?.({ type: 'hydrate', historyNavigation: true, hasMoreHistory: count > 8, messages: rows.slice(-8) })
    return () => { host.ReactNativeWebView = previous }
  }, [state, count, scheme, locale])
  return <div className="mx-auto max-w-[430px]"><ChatView /></div>
}
const meta = { title: 'Chat/Mobile full history navigation', component: HistoryNavigationPreview,
  render: (args, context) => <HistoryNavigationPreview {...args} scheme={context.globals.theme ?? 'light'} locale={context.globals.locale ?? 'en'} />,
  parameters: { layout: 'fullscreen' } } satisfies Meta<typeof HistoryNavigationPreview>
export default meta
type Story = StoryObj<typeof meta>
export const FullHistory: Story = {}
export const Empty: Story = { args: { count: 0 } }
export const IndexLoading: Story = { args: { state: 'loading' } }
export const IndexFailed: Story = { args: { state: 'error' } }
export const JumpRetry: Story = { args: { state: 'jump-error' } }
export const PageLoading: Story = { args: { state: 'page-loading' } }
export const LongHistory: Story = { args: { count: 1000 } }
