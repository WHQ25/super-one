import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChatView } from './ChatView'
import type { ScheduledSendView } from './protocol'

function Preview({ armed = false, busy = false, offline = false, error = '', width = 390 }: { armed?: boolean; busy?: boolean; offline?: boolean; error?: string; width?: number }) {
  useEffect(() => {
    const host = globalThis as typeof globalThis & { __applyHost?: (message: unknown) => void; ReactNativeWebView?: { postMessage(raw: string): void } }
    const previous = host.ReactNativeWebView
    let state: ScheduledSendView = { scheduled: { sessionId: 's', sendAt: Date.now() + 3600000, armed, source: 'rate_limit', message: null }, busy, available: !offline, error }
    host.ReactNativeWebView = { postMessage(raw) {
      const message = JSON.parse(raw)
      if (message.type !== 'scheduledSendAction') return
      state = { ...state, scheduled: message.action === 'dismiss' ? null : { ...state.scheduled!, armed: message.action === 'accept' } }
      host.__applyHost?.({ type: 'setScheduledSend', state })
    } }
    host.__applyHost?.({ type: 'channelToken', token: 'scheduled-resume-story' })
    host.__applyHost?.({ type: 'setViewport', locale: 'zh' })
    host.__applyHost?.({ type: 'hydrate', sessionId: 's', messages: [{ id: 'a', role: 'assistant', status: 'error', createdAt: new Date().toISOString(), content: [{ type: 'text', text: '已达到五小时用量上限。' }] }] })
    host.__applyHost?.({ type: 'setScheduledSend', state })
    return () => { host.ReactNativeWebView = previous }
  }, [armed, busy, offline, error])
  return <div style={{ width, maxWidth: '100%' }}><ChatView /></div>
}
export default { title: 'Chat/Mobile scheduled resume', component: Preview, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Preview>
type Story = StoryObj<typeof Preview>
export const Offer: Story = {}
export const Armed: Story = { args: { armed: true } }
export const Narrow: Story = { args: { width: 240 } }
export const Saving: Story = { args: { busy: true } }
export const Offline: Story = { args: { offline: true } }
export const Failed: Story = { args: { error: '连接已中断，请重试。' } }
