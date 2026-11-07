import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, HarnessId } from '@superone/shared/agent-types'
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

function PendingSendPreview({ narrow = false, failed = false, local = false, harness = 'claude', runtime = 'sending' }: {
  narrow?: boolean; failed?: boolean; local?: boolean; harness?: HarnessId
  runtime?: 'sending' | 'retrying' | 'exhausted' | 'before-reply' | 'mcp'
}) {
  const project = local ? '/work/app' : PROJECT
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const settle = (failure: boolean) => {
    const store = useChatStore.getState()
    if (failure) {
      store.handleAgentEvent({ projectPath: project, sessionId: SESSION,
        type: 'user_message_send_failed', clientMessageId: user.id, error: 'The remote node is unavailable. Reconnect and try again.' })
    } else {
      store.handleAgentEvent({ projectPath: project, sessionId: SESSION, type: 'status_change', status: 'streaming' })
      store.handleAgentEvent({ projectPath: project, sessionId: SESSION, type: 'message_start', message: {
        id: 'first-assistant', role: 'assistant', status: 'streaming', providerId: harness,
        createdAt: new Date().toISOString(), content: [{ type: 'text', text: 'I’ll check the branch changes.' }],
      } })
    }
  }
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    const assistant: ChatMessage = {
      id: 'runtime-assistant', role: 'assistant', status: runtime === 'exhausted' ? 'error' : 'streaming',
      providerId: harness, createdAt: new Date().toISOString(),
      content: runtime === 'mcp' ? [] : [{ type: 'text', text: 'I’ll check the branch changes.' }],
      ...(runtime === 'mcp' ? { metadata: { codex: { threadId: 'thread', usage: null, items: [],
        mcpStartup: [{ name: 'superone', status: 'ready' }, { name: 'github', status: 'starting' }],
      } } } : {}),
    }
    const hasAssistant = runtime !== 'sending' && runtime !== 'before-reply'
    useChatStore.setState({ activeProject: project, projectSessions: {
      ...previous.projectSessions, [project]: {
        ...createDefaultProjectState(), _activeSessionId: SESSION, _sessions: { [SESSION]: {
          ...createDefaultPerSessionState(), messages: hasAssistant ? [user, assistant] : [user], awaitingAssistantReply: !hasAssistant,
          status: runtime === 'exhausted' ? 'idle' : 'streaming',
          sessionProvider: harness, acpAgentId: harness === 'acp' ? 'grok-build' : null, cwd: '/work/app',
        } },
      },
    } })
    useAppStore.setState({ harnessCatalog: null })
    if (['retrying', 'exhausted', 'before-reply'].includes(runtime)) {
      useChatStore.getState().handleAgentEvent({ projectPath: project, sessionId: SESSION, type: 'api_retry',
        attempt: 2, maxRetries: 5, delayMs: 8000, phase: runtime === 'exhausted' ? 'exhausted' : 'retrying', message: 'rate limited',
      })
    }
    if (failed) settle(true)
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
    }
  }, [failed, project, harness, runtime])
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
    const sending = await canvas.findByText('Sending…')
    expect(sending.closest('.group\\/footer')).toHaveAttribute('data-pending-turn', 'sending')
    expect(sending.parentElement?.querySelectorAll('.animate-spin')).toHaveLength(1)
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
    expect(context.canvasElement.querySelectorAll('.assistant-reply .animate-spin')).toHaveLength(1)
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

export const LocalSend: Story = {
  args: { local: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(user.content[0].type === 'text' ? user.content[0].text : '')
    expect(canvas.queryByText('Sending…')).toBeNull()
    expect(canvasElement.querySelector('[data-pending-turn]')).toBeNull()
  },
}

const checkRetry: Story['play'] = async ({ canvasElement }) => {
  await expect(within(canvasElement).findByText(/Retrying API request/)).resolves.toBeInTheDocument()
  const retry = canvasElement.querySelector('[data-turn-retry]')
  expect(retry?.closest('.assistant-reply .group\\/footer')).not.toBeNull()
  expect(canvasElement.querySelectorAll('.assistant-reply .animate-spin')).toHaveLength(1)
  expect(retry?.outerHTML).not.toMatch(/text-warning|bg-warning|text-error|bg-error/)
}
export const ClaudeRetry: Story = { args: { runtime: 'retrying', harness: 'claude' }, play: checkRetry }
export const CodexRetry: Story = { args: { runtime: 'retrying', harness: 'codex' }, play: checkRetry }
export const GrokRetry: Story = { args: { runtime: 'retrying', harness: 'acp' }, play: checkRetry }
export const LocalRetryBeforeReply: Story = { args: { runtime: 'before-reply', local: true }, play: checkRetry }
export const RetryExhausted: Story = {
  args: { runtime: 'exhausted' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('button', { name: /try again/i })).resolves.toBeInTheDocument()
    expect(canvasElement.querySelector('.assistant-reply [data-turn-retry="exhausted"]')).not.toBeNull()
    expect(canvasElement.querySelectorAll('.assistant-reply .animate-spin')).toHaveLength(0)
  },
}
export const RetryRecovers: Story = {
  args: { runtime: 'retrying' },
  play: async context => {
    await checkRetry?.(context)
    await userEvent.click(within(context.canvasElement).getByRole('button', { name: 'Assistant starts' }))
    await expect(within(context.canvasElement).findAllByText('I’ll check the branch changes.')).resolves.toHaveLength(2)
    expect(context.canvasElement.querySelector('[data-turn-retry]')).toBeNull()
  },
}
export const NarrowRetry: Story = { args: { runtime: 'retrying', narrow: true }, play: checkRetry }
export const DarkChineseRetry: Story = { args: { runtime: 'retrying' }, globals: { theme: 'dark', locale: 'zh' } }
export const McpStartup: Story = {
  args: { runtime: 'mcp', harness: 'codex' },
  play: async ({ canvasElement }) => {
    const text = await within(canvasElement).findByText('Starting MCP servers 1/2')
    expect(text.closest('.assistant-reply .group\\/footer')).not.toBeNull()
    expect(canvasElement.querySelectorAll('.assistant-reply .animate-spin')).toHaveLength(1)
  },
}
