import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'
import { ChatMessage } from './ChatMessage'

/** A session row is enough — the user bubble reads nothing else from the store. */
function SeedChatSession({ children }: { children: ReactNode }) {
  useEffect(() => {
    useChatStore.setState({
      activeProject: '/storybook/goal-message',
      projectSessions: {
        '/storybook/goal-message': {
          ...createDefaultProjectState(),
          _activeSessionId: 'story-session',
          _sessions: { 'story-session': { ...createDefaultPerSessionState(), status: 'idle' as const } },
        },
      },
    })
  }, [])
  return <>{children}</>
}

function makeUser(text: string, id = 'user-1'): ChatMessageType {
  return {
    id,
    role: 'user',
    status: 'complete',
    providerId: 'user',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    content: [{ type: 'text', text }],
  }
}

function Thread({ messages }: { messages: ChatMessageType[] }) {
  return (
    <div className="@container mx-auto flex w-full max-w-[640px] flex-col gap-1.5 rounded-xl border border-border/60 bg-background p-3.5">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} sessionStatus="idle" isLastAssistant={false} />
      ))}
    </div>
  )
}

const meta: Meta<typeof Thread> = {
  title: 'Chat/GoalMessage',
  component: Thread,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A sent `/goal …` line renders as the objective under a Goal label; the bubble itself stays the ordinary user bubble. Lifecycle lines (`/goal clear`) and prompts get no label.',
      },
    },
  },
  decorators: [(Story) => <SeedChatSession><Story /></SeedChatSession>],
}

export default meta
type Story = StoryObj<typeof Thread>

/** The objective, not the slash line, is what the bubble shows. */
export const Objective: Story = {
  args: { messages: [makeUser('/goal Migrate the auth module to the new API and land the tests')] },
}

/** Claude's goals are conditions; the bubble is the same, only the wording differs. */
export const ClaudeCondition: Story = {
  args: { messages: [makeUser('/goal The whole test suite passes and typecheck is green')] },
}

/** Lifecycle lines are not goals — they stay plain, next to a real one for contrast. */
export const NextToLifecycleAndPrompt: Story = {
  args: {
    messages: [
      makeUser('Please look at the failing login tests first.', 'user-0'),
      makeUser('/goal Ship the login flow', 'user-1'),
      makeUser('/goal pause', 'user-2'),
      makeUser('/goal clear', 'user-3'),
    ],
  },
}

/** A multi-line objective wraps inside the bubble like any user text. */
export const LongObjective: Story = {
  args: {
    messages: [makeUser(
      '/goal Replace every call site of the legacy HTTP client with the new fetch wrapper.\n'
      + 'Keep the retry semantics identical, add contract tests for each endpoint family, '
      + 'update the ADR, and make sure the release notes mention the behaviour change for 4xx responses.',
    )],
  },
}
