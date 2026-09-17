import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ChatMessage } from './ChatMessage'

const projectPath = '/storybook/realtime-delegation'
const sessionId = 'story-session'

/** A session row is enough — the user bubble reads nothing else from the store. */
function SeedChatSession({ children }: { children: ReactNode }) {
  useEffect(() => {
    useChatStore.setState({
      activeProject: projectPath,
      projectSessions: {
        [projectPath]: {
          ...createDefaultProjectState(),
          _activeSessionId: sessionId,
          _sessions: { [sessionId]: { ...createDefaultPerSessionState(), status: 'idle' as const, sessionProvider: 'codex' } },
        },
      },
    })
    return () => useCodexRealtimeViewStore.setState({ sessions: {} })
  }, [])
  return <>{children}</>
}

const TRANSCRIPT = [
  'user: 帮我看一下最近一次提交',
  'assistant: 好的，我让 Codex 检查一下',
  'user: 顺便把风险点写进 CHANGELOG',
].join('\n')

/** The exact envelope Codex injects: escaped fields, optional source and transcript. */
function delegation(text: string, options: { id?: string; transcript?: boolean; tailFlush?: boolean } = {}): ChatMessageType {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = [
    '<realtime_delegation>',
    ...(options.tailFlush ? ['  <source>transcript_tail_flush</source>'] : []),
    `  <input>${escaped}</input>`,
    ...(options.transcript || options.tailFlush ? [`  <transcript_delta>${TRANSCRIPT}</transcript_delta>`] : []),
    '</realtime_delegation>',
  ].join('\n')
  return {
    id: options.id ?? 'delegation-1',
    role: 'user',
    status: 'complete',
    providerId: 'codex',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    content: [{ type: 'text', text: body }],
    metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 'turn-1', position: 4 } },
  }
}

function typed(text: string, id = 'typed-1'): ChatMessageType {
  return {
    id,
    role: 'user',
    status: 'complete',
    providerId: 'codex',
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    content: [{ type: 'text', text }],
  }
}

function Thread({ messages, width = 640 }: { messages: ChatMessageType[]; width?: number }) {
  const jump = useCodexRealtimeViewStore((state) => state.sessions[sessionId]?.pendingJump ?? null)
  return (
    <div className="@container mx-auto flex w-full flex-col gap-1.5 rounded-xl border border-border/60 bg-background p-3.5" style={{ maxWidth: width }}>
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} sessionStatus="idle" isLastAssistant={false} />
      ))}
      <p className="mt-2 text-xs text-muted-foreground">
        {jump ? `Jump requested → ${jump.view} (turn ${jump.turnId ?? jump.messageId})` : 'Click the Voice Delegation label to jump back to the voice view.'}
      </p>
    </div>
  )
}

const meta: Meta<typeof Thread> = {
  title: 'Chat/Realtime Delegation Message',
  component: Thread,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The `<realtime_delegation>` envelope the voice agent injects into the backing Codex thread (`<input>` instruction, optional `<transcript_delta>` context, optional `<source>transcript_tail_flush</source>`) renders as an ordinary user bubble under a Voice Delegation label, with the spoken context folded underneath. The label links back to the spoken turn that delegated it.',
      },
    },
  },
  decorators: [(Story) => <SeedChatSession><Story /></SeedChatSession>],
}

export default meta
type Story = StoryObj<typeof Thread>

export const Delegation: Story = {
  args: { messages: [delegation('Review the last commit and summarize any risky changes in the realtime settings sync.')] },
}

/** A long instruction stays one paragraph — never the paste chip. Escaped `<`/`&` decode. */
export const LongWithTranscript: Story = {
  args: {
    messages: [delegation(
      'Run `bun run typecheck:web && bun run typecheck:node`, then for every error group the files by package, '
      + 'explain the likely cause (<5 lines each) and propose the smallest fix. Do not edit anything yet; '
      + 'report back so I can decide which ones to take now and which to defer to the release branch.',
      { transcript: true },
    )],
  },
}

/** After the call ends Codex flushes the remaining transcript; the boilerplate instruction stays out. */
export const SessionEndedHandoff: Story = {
  args: { messages: [delegation('The user just ended their realtime session. Here is the remaining handoff/transcript tail.', { tailFlush: true })] },
}

/** Typed and delegated turns sit side by side; only the delegated one carries the label. */
export const MixedWithTyped: Story = {
  args: {
    messages: [
      typed('Check the voice settings first.'),
      delegation('Now run the typecheck and report failures.', { id: 'delegation-2' }),
    ],
  },
}

export const NarrowDarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  args: {
    width: 320,
    messages: [delegation('检查最近一次提交，总结实时设置同步里有风险的改动，并把结果写进 CHANGELOG。', { transcript: true })],
  },
}
