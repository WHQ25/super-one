import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, type ReactNode } from 'react'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import type { AskUserQuestionRequest, ChatMessage as ChatMessageType, PermissionRequest } from '@superone/shared/agent-types'
import { isCodexAsyncAnswer, pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { ChatMessage } from './ChatMessage'
import { ComposerSwitch } from './ComposerSwitch'
import { DecisionComposer } from './DecisionComposer'

function SeedDecisionQueue({
  permissions,
  question,
  messages,
}: {
  permissions: PermissionRequest[]
  question: AskUserQuestionRequest | null
  messages: ChatMessageType[]
}) {
  useEffect(() => {
    const previous = useChatStore.getState()
    const apply = () => {
      useChatStore.setState((state) => {
        const projectPath = state.activeProject
        const project = projectPath ? state.projectSessions[projectPath] : null
        const sessionId = project?._activeSessionId
        const session = sessionId ? project?._sessions[sessionId] : null
        if (!projectPath || !project || !sessionId || !session) return state
        return {
          projectSessions: {
            ...state.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sessionId]: {
                  ...session,
                  pendingPermissions: permissions,
                  pendingQuestion: question,
                  messages,
                  pendingAsyncQuestions: pendingCodexAsyncQuestions(messages),
                },
              },
            },
          },
        }
      })
    }
    apply()
    const timer = window.setTimeout(apply, 0)
    return () => {
      window.clearTimeout(timer)
      useChatStore.setState(previous)
    }
  }, [permissions, question, messages])
  return null
}

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="flex h-[min(80vh,680px)] flex-col justify-end border border-border bg-background" style={{ width, maxWidth: '100%' }}>
      {children}
    </div>
  )
}

const QUESTION: AskUserQuestionRequest = {
  requestId: 'question-1',
  questions: [{
    question: 'Which validation should run before merging?',
    header: 'Checks',
    multiSelect: true,
    options: [
      { label: 'Typecheck', description: 'Check the affected packages.' },
      { label: 'Focused tests', description: 'Run the chat composer tests.' },
      { label: 'Storybook', description: 'Review the narrow layout.' },
    ],
  }],
}

const PREVIEW_OPTION = (label: string, rows: number) => ({
  label,
  description: `${label} layout for the handoff banner.`,
  preview: Array.from({ length: rows }, (_, i) => `- ${label} row ${i + 1}: banner copy, primary action and dismiss control`).join('\n'),
})

const TALL_QUESTION: AskUserQuestionRequest = {
  requestId: 'question-tall',
  questions: [
    {
      question: 'Which banner layout should the phone use? The desktop keeps its own setting for "don\'t show again".',
      header: 'Layout',
      multiSelect: false,
      options: [PREVIEW_OPTION('Single row', 24), PREVIEW_OPTION('Two rows', 18), PREVIEW_OPTION('Inline text', 12)],
    },
    { ...QUESTION.questions[0], header: 'Checks' },
  ],
}

const MIXED_PERMISSION: PermissionRequest = {
  requestId: 'permission-1',
  toolName: 'Bash',
  toolUseId: 'tool-1',
  input: { command: 'bun run typecheck:web', cwd: '/workspace' },
  allowAlwaysAllow: false,
}

const ELICITATION: PermissionRequest = {
  requestId: 'elicitation-1',
  toolName: 'project_preferences',
  input: {},
  allowAlwaysAllow: false,
  requestKind: 'mcp_elicitation',
  serverName: 'project-tools',
  message: 'Choose the project defaults to apply.',
  ...elicitationFormRequest({
    type: 'object',
    required: ['style'],
    properties: {
      style: { type: 'string', title: 'Preferred style', enum: ['compact', 'spacious'] },
      includeTests: { type: 'boolean', title: 'Include tests by default' },
    },
  }),
}

const LONG_COMMAND: PermissionRequest = {
  ...MIXED_PERMISSION,
  requestId: 'permission-long-command',
  input: {
    command: `bun run test -- --run apps/desktop/src/renderer/src/components/chat/DecisionComposer.test.tsx &&\n  bun run typecheck:web &&\n  git diff --check &&\n  node scripts/verify-composer-layout.mjs --theme both --locale en,zh`,
    cwd: '/workspace',
  },
}

const EMPTY_MESSAGES: ChatMessageType[] = []
const ASYNC_QUESTIONS: ChatMessageType[] = [{
  id: 'async-turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
  metadata: { codex: { threadId: 'thread', usage: null, items: [
    { id: 'environment', type: 'agent_message', delivery: 'async', text: '', questions: [{ title: 'Which environment should receive the update?', options: ['Staging', 'Production'] }] },
    { id: 'deadline', type: 'agent_message', delivery: 'async', text: '', questions: [{ title: 'When should it ship?', options: null }] },
  ] } },
}]

function AsyncAnswerHistory() {
  const messages = useActiveSession(session => session.messages)
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    {messages.filter(isCodexAsyncAnswer).map(message => <ChatMessage key={message.id} message={message} sessionStatus="streaming" isLastAssistant={false} />)}
  </div>
}

function QueueStory({
  permissions = [MIXED_PERMISSION],
  question = QUESTION,
  width,
  messages = EMPTY_MESSAGES,
  retry = false,
  cap,
}: {
  permissions?: PermissionRequest[]
  question?: AskUserQuestionRequest | null
  width?: number
  messages?: ChatMessageType[]
  retry?: boolean
  /** Renders inside the production slot capped at this height, as a short window would. */
  cap?: number
}) {
  const restoreMocks = useMemo(() => {
    if (messages.length === 0) return undefined
    const previous = window.environment
    let failed = false
    window.environment = {
      ...previous,
      callSession: async (_connectionId: string, _sessionId: string, _method: string, input: { answers: string[] }) => {
        if (retry && !failed) { failed = true; throw new Error('Connection lost. Try submitting again.') }
        return { reply: input.answers.join('\n') }
      },
    } as unknown as typeof window.environment
    mockIpc('app', 'getMediaServerPort', async () => 0)
    return () => { window.environment = previous }
  }, [messages, retry])
  useEffect(() => restoreMocks, [restoreMocks])
  return (
    <StoryShell width={width}>
      <AsyncAnswerHistory />
      <SeedDecisionQueue permissions={permissions} question={question} messages={messages} />
      {cap === undefined
        ? <DecisionComposer />
        : <ComposerSwitch kind="decision" maxHeight={cap} render={() => <DecisionComposer />} />}
    </StoryShell>
  )
}

const meta = {
  title: 'Chat/DecisionComposer',
  component: QueueStory,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof QueueStory>

export default meta
type Story = StoryObj<typeof meta>

export const MixedQueue: Story = {}
export const NarrowQueue: Story = { args: { width: 320 } }
export const ElicitationForm: Story = { args: { permissions: [ELICITATION], question: null } }
export const LongCommand: Story = { args: { permissions: [LONG_COMMAND], question: null } }
export const AsyncQuestionQueue: Story = { args: { permissions: [], question: null, messages: ASYNC_QUESTIONS } }
export const AsyncQuestionNarrow: Story = { args: { permissions: [], question: null, messages: ASYNC_QUESTIONS, width: 320 } }
export const AsyncQuestionRetry: Story = { args: { permissions: [], question: null, messages: ASYNC_QUESTIONS, retry: true } }
export const CappedQuestion: Story = { args: { permissions: [], question: TALL_QUESTION, cap: 320 } }
export const CappedQuestionNarrow: Story = { args: { permissions: [], question: TALL_QUESTION, cap: 320, width: 320 } }
export const CappedPermission: Story = { args: { permissions: [LONG_COMMAND], question: null, cap: 120 } }
export const CappedElicitation: Story = { args: { permissions: [ELICITATION], question: null, cap: 140 } }
