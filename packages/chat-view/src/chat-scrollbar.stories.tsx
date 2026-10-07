import { useEffect, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, Locale } from '@superone/shared/agent-types'
import { ChatView } from './ChatView'

function ScrollbarPreview({ streaming = false, count = 12, scheme = 'light', locale = 'en' }: {
  streaming?: boolean; count?: number; scheme?: 'light' | 'dark'; locale?: Locale
}) {
  const stopped = useRef(false)
  useEffect(() => {
    const host = globalThis as typeof globalThis & { __applyHost?: (value: unknown) => void }
    const messages: ChatMessage[] = Array.from({ length: count }, (_, index) => ({
      id: `scrollbar-${index}`, role: index % 2 ? 'assistant' : 'user', providerId: 'claude',
      status: 'complete', createdAt: '', content: [{ type: 'text', text: index % 2
        ? 'A paragraph in the response. '.repeat(40) : `Question ${index / 2 + 1}` }],
    }))
    host.__applyHost?.({ type: 'setTheme', scheme })
    host.__applyHost?.({ type: 'setViewport', locale })
    host.__applyHost?.({ type: 'hydrate', messages })
    stopped.current = false
    if (!streaming || !messages.length) return
    let chunk = 0
    const timer = setInterval(() => {
      if (stopped.current) return
      const last = messages.at(-1)!
      host.__applyHost?.({ type: 'applyReductionPatch', sessionStatus: 'streaming', messages: [
        ...messages.slice(0, -1), { ...last, status: 'streaming',
          content: [{ type: 'text', text: 'Incoming response paragraph. '.repeat(40 + ++chunk * 4) }] },
      ] })
    }, 250)
    return () => clearInterval(timer)
  }, [streaming, count, scheme, locale])
  return <div className="mx-auto max-w-[430px]">
    <div className="fixed left-3 top-3 z-30 rounded border bg-background p-2 text-xs">
      Scroll the transcript to reveal the scrollbar.
      {streaming && <button className="ml-2 rounded border px-2 py-1" onClick={() => { stopped.current = !stopped.current }}>
        Pause / resume output
      </button>}
    </div>
    <ChatView />
  </div>
}

const meta = { title: 'Chat/Mobile manual scrollbar', component: ScrollbarPreview,
  render: (args, context) => <ScrollbarPreview {...args} scheme={context.globals.theme ?? 'light'} locale={context.globals.locale ?? 'en'} />,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ScrollbarPreview>
export default meta
type Story = StoryObj<typeof meta>
export const ManualScroll: Story = {}
export const AutomaticStreaming: Story = { args: { streaming: true } }
export const ShortConversation: Story = { args: { count: 1 } }
export const Empty: Story = { args: { count: 0 } }
