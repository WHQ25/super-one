import { useEffect, useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage } from '@superone/shared/agent-types'
import { TranscriptDelivery } from '../../../apps/mobile/src/transcript-delivery'
import { ChatView } from './ChatView'
import type { HostInbound } from './protocol'

const user: ChatMessage = { id: 'question', role: 'user', status: 'complete', providerId: 'local', createdAt: '', content: [{ type: 'text', text: 'Explain the result.' }] }
const thinking: ChatMessage = { id: 'answer', role: 'assistant', status: 'streaming', providerId: 'claude', createdAt: '', content: [{ type: 'thinking', thinking: 'Checking the result.' }] }
const answer: ChatMessage = { ...thinking, status: 'complete', content: [{ type: 'text', text: 'The answer recovered without switching sessions.' }] }

function TranscriptRecovery({ lost = 'insertion' }: { lost?: 'none' | 'insertion' | 'final' }) {
  const start = useRef(() => {})
  useEffect(() => {
    const host = globalThis as typeof globalThis & { __applyHost?: (message: HostInbound) => void; ReactNativeWebView?: { postMessage(raw: string): void } }
    const previous = host.ReactNativeWebView
    let dropped = false
    const delivery = new TranscriptDelivery(message => {
      if (message.type === 'applyReductionPatch' && !dropped && lost !== 'none'
        && (lost === 'insertion' || message.sessionStatus === 'idle')) {
        dropped = true
        return
      }
      host.__applyHost?.(message)
    })
    host.ReactNativeWebView = { postMessage(raw) {
      const message = JSON.parse(raw)
      if (message.type === 'transcriptApplied') delivery.acknowledge(message.channelId, message.sequence)
    } }
    delivery.publish({ messages: [user], sessionStatus: 'idle' }, true)
    start.current = () => {
      dropped = false
      delivery.publish({ messages: [user], sessionStatus: 'idle' }, true)
      delivery.publish({ messages: [user, thinking], sessionStatus: 'streaming' })
      delivery.publish({ messages: [user, answer], sessionStatus: 'idle' })
    }
    return () => { delivery.dispose(); host.ReactNativeWebView = previous; start.current = () => {} }
  }, [lost])
  return <div className="mx-auto max-w-[390px]">
    <button className="rounded border px-3 py-2 text-sm" onClick={() => start.current()}>Stream a response</button>
    <ChatView />
  </div>
}
const meta = { title: 'Chat/Mobile transcript recovery', component: TranscriptRecovery } satisfies Meta<typeof TranscriptRecovery>
export default meta
type Story = StoryObj<typeof meta>
export const Normal: Story = { args: { lost: 'none' } }
export const LostInsertion: Story = { args: { lost: 'insertion' } }
export const LostFinalAnswer: Story = { args: { lost: 'final' } }
