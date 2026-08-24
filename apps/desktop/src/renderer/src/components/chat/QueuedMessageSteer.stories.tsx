import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { ChatContent } from './ChatContent'

const STORY_PROJECT = '__storybook__'
const STORY_SESSION = 'sb'

mockIpc('app', 'listPlatforms', async () => [])
mockIpc('app', 'listCredentials', async () => [])
mockIpc('app', 'listBindings', async () => [])

const queuedMessages: ChatMessage[] = [
  {
    id: 'queued-steer-1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: '先暂停重构，直接修复 queued message 的交互。' }],
    createdAt: '2026-08-25T08:00:00.000Z',
    providerId: 'local',
  },
  {
    id: 'queued-steer-2',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: '修完后补一个 Storybook story。' }],
    createdAt: '2026-08-25T08:00:01.000Z',
    providerId: 'local',
  },
]

type SteerProvider = 'claude' | 'codex'

function seedQueuedMessages(provider: SteerProvider): void {
  const project = createDefaultProjectState()
  const session = {
    ...createDefaultPerSessionState(),
    status: 'streaming' as const,
    sessionProvider: provider,
    preferredProvider: provider,
    queuedMessages,
  }

  useChatStore.setState({
    activeProject: STORY_PROJECT,
    projectSessions: {
      [STORY_PROJECT]: {
        ...project,
        _activeSessionId: STORY_SESSION,
        _sessions: { [STORY_SESSION]: session },
      },
    },
  })
  useSettingsStore.setState({
    platforms: [],
    credentials: [],
    bindings: [],
    providerScope: 'local',
  })
}

function removeQueuedMessage(messageId: string): void {
  useChatStore.setState((state) => {
    const project = state.projectSessions[STORY_PROJECT]
    const session = project?._sessions[STORY_SESSION]
    if (!project || !session) return state

    return {
      projectSessions: {
        ...state.projectSessions,
        [STORY_PROJECT]: {
          ...project,
          _sessions: {
            ...project._sessions,
            [STORY_SESSION]: {
              ...session,
              queuedMessages: session.queuedMessages.filter((message) => message.id !== messageId),
            },
          },
        },
      },
    }
  })
}

mockIpc('agent', 'steerQueuedMessage', async (_projectPath, messageId) => {
  if (typeof messageId !== 'string') return false
  removeQueuedMessage(messageId)
  return true
})

function SeedQueuedMessages({ children, provider }: { children: ReactNode; provider: SteerProvider }) {
  useState(() => {
    seedQueuedMessages(provider)
    return null
  })

  useEffect(() => {
    // The global harness decorator seeds its own session after the first render.
    // Re-apply this scenario once that effect has completed.
    const timer = window.setTimeout(() => seedQueuedMessages(provider), 0)
    return () => window.clearTimeout(timer)
  }, [provider])

  return <>{children}</>
}

function QueueSteerDemo({ provider }: { provider: SteerProvider }) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex w-[720px] flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Hover a queued message, then click the forward icon to steer the active {provider === 'claude' ? 'Claude' : 'Codex'} turn.
      </p>
      <div className="@container flex h-[460px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <ChatContent scrollViewportRef={scrollViewportRef} foreground={false} />
      </div>
    </div>
  )
}

const meta: Meta<typeof QueueSteerDemo> = {
  title: 'Chat/Queued Message Steer',
  component: QueueSteerDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A local turn is streaming with two SuperOne-visible queued messages. Hover either message to reveal Steer, Edit, and Delete; Steer removes that message from the queue and injects it into the active Claude or Codex turn.',
      },
    },
  },
  decorators: [(Story, context) => (
    <SeedQueuedMessages provider={context.args.provider}>
      <Story />
    </SeedQueuedMessages>
  )],
}

export default meta
type Story = StoryObj<typeof QueueSteerDemo>

export const StreamingCodex: Story = {
  args: { provider: 'codex' },
  globals: { harness: 'codex' },
}

export const StreamingClaude: Story = {
  args: { provider: 'claude' },
  globals: { harness: 'claude' },
}
