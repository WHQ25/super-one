import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatContent } from './ChatContent'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'

mockTranscriptIpc()

const PROJECT = 'remote:pending-send-preview:/work/app'
const SESSION = 'pending-send'
const user: ChatMessage = {
  id: 'first-user', role: 'user', status: 'complete', providerId: 'local',
  createdAt: '2026-11-05T12:00:00.000Z',
  content: [{ type: 'text', text: 'Summarize what changed in this branch and draft a PR description.' }],
}

function PendingSendPreview({ narrow = false, failed = false }: { narrow?: boolean; failed?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const settle = (failure: boolean) => {
    const store = useChatStore.getState()
    if (failure) {
      store.handleAgentEvent({ projectPath: PROJECT, sessionId: SESSION,
        type: 'user_message_send_failed', clientMessageId: user.id, error: 'The remote node is unavailable. Reconnect and try again.' })
    } else {
      store.handleAgentEvent({ projectPath: PROJECT, sessionId: SESSION, type: 'message_start', message: {
        id: 'first-assistant', role: 'assistant', status: 'streaming', providerId: 'claude',
        createdAt: user.createdAt, content: [{ type: 'text', text: 'I’ll check the branch changes.' }],
      } })
    }
  }
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    useChatStore.setState({ activeProject: PROJECT, projectSessions: {
      ...previous.projectSessions, [PROJECT]: {
        ...createDefaultProjectState(), _activeSessionId: SESSION, _sessions: { [SESSION]: {
          ...createDefaultPerSessionState(), messages: [user], awaitingAssistantReply: true,
          sessionProvider: 'claude', cwd: '/work/app',
        } },
      },
    } })
    useAppStore.setState({ harnessCatalog: null })
    if (failed) settle(true)
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
    }
  }, [failed])
  return <TooltipProvider>
    <div className="flex max-w-full flex-col gap-3" style={{ width: narrow ? 320 : 760 }}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => settle(false)}>Assistant starts</Button>
        <Button size="sm" variant="outline" onClick={() => settle(true)}>Send fails</Button>
      </div>
      <div className="@container flex h-[560px] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
        {ready && <ChatContent scrollViewportRef={scrollRef} foreground={false} />}
      </div>
    </div>
  </TooltipProvider>
}

const meta = { title: 'Chat/Remote first send', component: PendingSendPreview, parameters: { layout: 'padded' } } satisfies Meta<typeof PendingSendPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Sending: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Sending…')).resolves.toBeInTheDocument()
    await expect(canvas.findByText(user.content[0].type === 'text' ? user.content[0].text : '')).resolves.toBeInTheDocument()
  },
}
export const AssistantStarts: Story = {
  play: async context => {
    await Sending.play?.(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Assistant starts' }))
    await expect(canvas.findByText('I’ll check the branch changes.')).resolves.toBeInTheDocument()
    expect(context.canvasElement.querySelector('[data-pending-turn]')).toBeNull()
  },
}
export const SendFails: Story = {
  play: async context => {
    await Sending.play?.(context)
    const canvas = within(context.canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send fails' }))
    await expect(canvas.findByRole('button', { name: 'Resend' })).resolves.toBeInTheDocument()
    expect(context.canvasElement.querySelector('[data-pending-turn]')).toBeNull()
  },
}
export const Failure: Story = { args: { failed: true } }
export const Narrow: Story = { args: { narrow: true }, play: Sending.play }
export const DarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('发送中…')).resolves.toBeInTheDocument()
  },
}
