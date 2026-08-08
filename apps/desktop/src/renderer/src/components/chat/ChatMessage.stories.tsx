import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType, ContentBlock } from '@superone/shared/agent-types'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import {
  ChatMessage,
  TurnMetaIndicator,
} from './ChatMessage'

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container mx-auto w-full" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

/** Seed session + Detail Mode so footer tokens and full process content render. */
function SeedChatSession({ children }: { children: ReactNode }) {
  useEffect(() => {
    useAppStore.setState({ detailChatMode: true })
    const project = createDefaultProjectState()
    const session = {
      ...createDefaultPerSessionState(),
      status: 'idle' as const,
      streamingTokens: { input: 0, output: 0 },
    }
    useChatStore.setState({
      activeProject: '/storybook/turn-meta',
      projectSessions: {
        '/storybook/turn-meta': {
          ...project,
          _activeSessionId: 'story-session',
          _sessions: {
            'story-session': session,
          },
        },
      },
    })
  }, [])
  return <>{children}</>
}

function makeAssistant(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: 'assistant-1',
    role: 'assistant',
    status: 'complete',
    providerId: 'acp',
    createdAt: new Date(Date.now() - 45_000).toISOString(),
    content: [
      {
        type: 'text',
        text: 'Grok ACP 的正文是流式的；tool 参数一般是整包发出，所以卡片会一次性出现。',
      } satisfies ContentBlock,
    ],
    metadata: {
      durationMs: 45_000,
      consumedTokens: { input: 18_400, output: 2_600 },
      turnSummary: 'Tool 参数不流式：Grok 整包发，非我们关掉',
    },
    ...overrides,
  }
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

function Thread({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background p-3 @lg:gap-1.5 @lg:p-3.5">
      {children}
    </div>
  )
}

const meta: Meta = {
  title: 'Chat/TurnSummaryAndRecap',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Grok turn summary sits above the assistant turn footer; session recap stays a standalone system line with a History icon.',
      },
    },
  },
  decorators: [
    (Story) => (
      <SeedChatSession>
        <StoryShell>
          <Story />
        </StoryShell>
      </SeedChatSession>
    ),
  ],
}

export default meta
type Story = StoryObj

/** Summary above footer (metadata.turnSummary) — the common post-turn case. */
export const TurnSummaryAboveFooter: Story = {
  name: 'Turn summary above footer',
  render: () => (
    <Thread>
      <ChatMessage
        message={makeUser('grok acp 支持流式吗？tool call 为什么是一次性的？')}
        sessionStatus="idle"
        isLastAssistant={false}
      />
      <ChatMessage
        message={makeAssistant()}
        sessionStatus="idle"
        isLastAssistant
      />
    </Thread>
  ),
}

/** Auto return-from-away recap — italic body + History icon, no “Recap” label. */
export const AutoSessionRecap: Story = {
  name: 'Session recap (auto)',
  render: () => (
    <Thread>
      <ChatMessage
        message={makeAssistant({
          id: 'assistant-prior',
          metadata: {
            durationMs: 32_000,
            consumedTokens: { input: 12_100, output: 1_800 },
            turnSummary: '已说明 ACP 流式与 tool 原子整包差异',
          },
        })}
        sessionStatus="idle"
        isLastAssistant
      />
      <div data-message-id="recap-auto" className="chat-message-wrapper">
        <TurnMetaIndicator
          meta={{
            kind: 'recap',
            text: '你离开期间：对齐了 Grok ACP 流式边界，并把 turn summary 挪到 footer 上方。',
            auto: true,
          }}
        />
      </div>
    </Thread>
  ),
}

/** Manual `/recap` — History icon + “Recap” label. */
export const ManualSessionRecap: Story = {
  name: 'Session recap (manual)',
  render: () => (
    <Thread>
      <div data-message-id="recap-manual" className="chat-message-wrapper">
        <TurnMetaIndicator
          meta={{
            kind: 'recap',
            text: '本会话讨论了 ACP 流式、tool 参数整包，以及 summary / recap 的 UI 分层。',
            auto: false,
          }}
        />
      </div>
    </Thread>
  ),
}

/**
 * Full vertical stack as it appears in chat:
 * user → assistant (summary above footer) → recap line → (composer would be next).
 */
export const FullTurnStack: Story = {
  name: 'Full turn stack',
  render: () => (
    <Thread>
      <ChatMessage
        message={makeUser('我感觉现在的 grok 每个 turn 的 summary 放在这里不太好看')}
        sessionStatus="idle"
        isLastAssistant={false}
      />
      <ChatMessage message={makeAssistant()} sessionStatus="idle" isLastAssistant />
      <div data-message-id="session_recap_1" className="chat-message-wrapper">
        <TurnMetaIndicator
          meta={{
            kind: 'recap',
            text: '回来了：上次在调 turn summary 位置，recap 保留在消息流底部并加了 History icon。',
            auto: true,
          }}
        />
      </div>
      <div className="mt-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
        composer…
      </div>
    </Thread>
  ),
}

/** Side-by-side: no summary vs with summary (footer spacing). */
export const WithAndWithoutSummary: Story = {
  name: 'With / without turn summary',
  render: () => (
    <div className="grid gap-4 @md:grid-cols-2">
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Without summary</div>
        <Thread>
          <ChatMessage
            message={makeAssistant({
              id: 'a-plain',
              metadata: {
                durationMs: 45_000,
                consumedTokens: { input: 18_400, output: 2_600 },
              },
            })}
            sessionStatus="idle"
            isLastAssistant
          />
        </Thread>
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">With summary</div>
        <Thread>
          <ChatMessage
            message={makeAssistant({ id: 'a-summary' })}
            sessionStatus="idle"
            isLastAssistant
          />
        </Thread>
      </div>
    </div>
  ),
}
