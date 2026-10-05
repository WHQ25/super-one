import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import type { AskUserQuestionRequest, PermissionRequest } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { DecisionComposer } from './DecisionComposer'

function SeedDecisionQueue({
  permissions,
  question,
}: {
  permissions: PermissionRequest[]
  question: AskUserQuestionRequest | null
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
  }, [permissions, question])
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

function QueueStory({
  permissions = [MIXED_PERMISSION],
  question = QUESTION,
  width,
}: {
  permissions?: PermissionRequest[]
  question?: AskUserQuestionRequest | null
  width?: number
}) {
  return (
    <StoryShell width={width}>
      <div className="min-h-0 flex-1" />
      <SeedDecisionQueue permissions={permissions} question={question} />
      <DecisionComposer />
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
