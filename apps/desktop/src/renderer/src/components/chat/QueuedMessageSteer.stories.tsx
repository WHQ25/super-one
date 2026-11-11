import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
mockIpc('app', 'codexListAccounts', async () => [])
mockIpc('app', 'codexListModels', async () => [])
mockIpc('app', 'claudeListAccounts', async () => [])
mockIpc('environment', 'listRemoteClaudeAccounts', async () => [])
mockIpc('environment', 'listRemoteCredentials', async () => [])
mockIpc('environment', 'listRemoteBindings', async () => [])
mockIpc('environment', 'listRemoteCustomPlatforms', async () => [])

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

type SteerProvider = 'claude' | 'codex' | 'opencode' | 'acp-grok'

const projectKey = (remote = false) => remote ? 'remote:queue-node:/work/app' : STORY_PROJECT

function seedQueuedMessages(provider: SteerProvider, nativeV2 = false, remote = false): void {
  const path = projectKey(remote)
  const project = createDefaultProjectState()
  const session = {
    ...createDefaultPerSessionState(),
    status: 'streaming' as const,
    sessionProvider: provider,
    preferredProvider: provider,
    messages: [{
      id: 'active-assistant', role: 'assistant' as const, status: 'streaming' as const,
      providerId: provider, createdAt: '2026-08-25T07:59:00.000Z',
      content: [{ type: 'text' as const, text: 'Inspecting queued message interactions.' }],
    }],
    lastAssistantMessageId: 'active-assistant',
    queuedMessages,
    ...(remote ? { runtimeCapabilities: { harnessId: provider, supportsQueuedSteer: provider !== 'acp-grok', supportsQueuedSteerSoon: provider === 'claude' } } : {}),
    ...(provider === 'acp-grok' ? { acpAgentId: 'grok-build' } : {}),
    ...(provider === 'opencode' ? { runtimeCapabilities: { harnessId: 'opencode' as const, supportsQueuedSteer: nativeV2, supportsQueuedSteerSoon: false } } : {}),
  }

  useChatStore.setState({
    activeProject: path,
    projectSessions: {
      [path]: {
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

function removeQueuedMessage(path: string, messageId: string): void {
  useChatStore.setState((state) => {
    const project = state.projectSessions[path]
    const session = project?._sessions[STORY_SESSION]
    if (!project || !session) return state

    return {
      projectSessions: {
        ...state.projectSessions,
        [path]: {
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

mockIpc('environment', 'listItems', async () => [{ connectionId: 'queue-node', capabilities: { methods: ['session.dequeue', 'session.steer'] } }])
mockIpc('environment', 'callSession', async (_connectionId, _sessionId, method, input) => {
  const messageId = (input as { clientMessageId?: string }).clientMessageId
  const path = useChatStore.getState().activeProject
  if (!messageId || !path) return { ok: false, removed: false }
  if (method === 'session.dequeue') {
    removeQueuedMessage(path, messageId)
    return { removed: true }
  }
  if (method === 'session.steer') {
    useChatStore.getState().handleAgentEvent({ type: 'queued_message_consumed',
      projectPath: path, sessionId: STORY_SESSION, clientMessageId: messageId })
    return { ok: true }
  }
  return { ok: false }
})

function SeedQueuedMessages({ children, provider, nativeV2, remote }: { children: ReactNode; provider: SteerProvider; nativeV2?: boolean; remote?: boolean }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    seedQueuedMessages(provider, nativeV2, remote)
    setReady(true)
  }, [provider, nativeV2, remote])

  return ready ? <>{children}</> : null
}

function QueueSteerDemo({ provider, nativeV2, remote, narrow }: { provider: SteerProvider; nativeV2?: boolean; remote?: boolean; narrow?: boolean }) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  return (
    <div className={narrow ? "flex w-[360px] flex-col gap-2" : "flex w-[720px] flex-col gap-2"}>
      <p className="text-xs text-muted-foreground">
        Hover a queued message to steer the active {provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider === 'acp-grok' ? 'Grok' : 'OpenCode'} turn.
        {remote && ' Remote node queue; Edit and Delete withdraw the input from its host.'}
        {remote && provider === 'acp-grok' ? ' This node supports the queue without advertising native steering.' : provider === 'claude'
          ? ' Claude offers both: the chevrons-up icon delivers at the next step boundary, the ship wheel interrupts the tool in flight.'
          : provider === 'codex' ? ' Codex offers only the interrupting steer (ship wheel) — its Core queue has no non-aborting variant.'
          : provider === 'acp-grok' ? ' Grok offers only the ship wheel. It calls x.ai/interject and leaves the live turn running.'
          : nativeV2 ? ' OpenCode V2 admits the input at its next safe point without cancelling the running tool.' : ' OpenCode V1 keeps messages queued for the next turn.'}
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
          'A local or remote turn is streaming with two SuperOne-visible queued messages. Hover either message to reveal the steer actions plus Edit and Delete; steering removes that message from the queue and injects it into the active Claude or Codex turn. Claude additionally offers a non-interrupting steer (SDK priority `next`), which is why the Claude story shows one more icon than the Codex one.',
      },
    },
  },
  decorators: [(Story, context) => (
    <SeedQueuedMessages key={`${context.args.provider}:${context.args.remote}`} provider={context.args.provider} nativeV2={context.args.nativeV2} remote={context.args.remote}>
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
export const OpenCodeV2: Story = { args: { provider: 'opencode', nativeV2: true }, globals: { harness: 'opencode' } }
export const OpenCodeV1: Story = { args: { provider: 'opencode', nativeV2: false }, globals: { harness: 'opencode' } }
export const StreamingGrok: Story = { args: { provider: 'acp-grok' }, globals: { harness: 'acp-grok' } }


const steerActiveReply = (soon = false): NonNullable<Story['play']> => async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const name = soon ? /Steer Soon|尽快插入/ : /Steer Now|立即引导/
  await waitFor(() => expect(canvas.getAllByRole('button', { name })).toHaveLength(2))
  await userEvent.click(canvas.getAllByRole('button', { name })[0])
  const session = () => useChatStore.getState().projectSessions[projectKey(true)]._sessions[STORY_SESSION]
  await waitFor(() => expect(session().queuedMessages).toHaveLength(1))
  expect(session().awaitingAssistantReply).toBe(false)
  expect(canvasElement.querySelector('[data-pending-turn]')).toBeNull()
  // Remote steering continues the original reply without a new message_start.
  useChatStore.getState().handleAgentEvent({ type: 'content_delta', projectPath: projectKey(true),
    sessionId: STORY_SESSION, messageId: 'active-assistant',
    delta: { type: 'text', text: ' Continuing with the steered request.' } })
  await expect(canvas.findByText(/Continuing with the steered request/)).resolves.toBeInTheDocument()
  expect(canvasElement.querySelector('[data-pending-turn]')).toBeNull()
}

export const RemoteCodex: Story = { args: { provider: 'codex', remote: true }, globals: { harness: 'codex' }, play: steerActiveReply() }
export const RemoteClaude: Story = { args: { provider: 'claude', remote: true }, globals: { harness: 'claude' } }
export const RemoteClaudeSoon: Story = { ...RemoteClaude, play: steerActiveReply(true) }
export const RemoteQueueWithoutSteer: Story = { args: { provider: 'acp-grok', remote: true }, globals: { harness: 'acp-grok' } }
export const RemoteCodexDark: Story = { ...RemoteCodex, globals: { harness: 'codex', theme: 'dark' } }
export const RemoteCodexNarrow: Story = { ...RemoteCodex, args: { provider: 'codex', remote: true, narrow: true } }
export const RemoteCodexDarkChinese: Story = { ...RemoteCodexNarrow, globals: { harness: 'codex', theme: 'dark', locale: 'zh' } }
export const RemoteWithdraw: Story = {
  ...RemoteCodex,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByRole('button', { name: 'Delete Queued Message' })).toHaveLength(2))
    await userEvent.click(canvas.getAllByRole('button', { name: 'Delete Queued Message' })[0])
    await waitFor(() => expect(canvas.getAllByRole('button', { name: 'Delete Queued Message' })).toHaveLength(1))
  },
}
