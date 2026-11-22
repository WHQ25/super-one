import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect } from 'react'
import type { ReviewSessionData, ReviewWorkspaceData } from '@superone/shared/review-types'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type ReplyComment } from '@/stores/chat'
import { ReviewPanel, type ReviewPanelProps } from './ReviewPanel'

const PROJECT = '/workspace/demo-repo'
const SESSION = 'review-story-session'

const SAMPLE_PATCH_TS = [
  'diff --git a/src/auth/token.ts b/src/auth/token.ts',
  'index 1111111..2222222 100644',
  '--- a/src/auth/token.ts',
  '+++ b/src/auth/token.ts',
  '@@ -1,8 +1,11 @@',
  ' export interface TokenPayload {',
  '   sub: string',
  '-  exp: number',
  '+  exp: number',
  '+  scope: string[]',
  ' }',
  ' ',
  ' export function isExpired(payload: TokenPayload, now = Date.now()): boolean {',
  '-  return payload.exp < now',
  '+  const skewMs = 5_000',
  '+  return payload.exp * 1000 <= now + skewMs',
  ' }',
].join('\n')

const SAMPLE_PATCH_ADDED = [
  'diff --git a/src/auth/scope.ts b/src/auth/scope.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/auth/scope.ts',
  '@@ -0,0 +1,6 @@',
  '+export function hasScope(scopes: readonly string[], required: string): boolean {',
  '+  if (scopes.includes("*")) return true',
  '+  return scopes.includes(required)',
  '+}',
  '+',
  '+export const DEFAULT_SCOPES = ["read"] as const',
].join('\n')

const SAMPLE_WORKSPACE: ReviewWorkspaceData = {
  root: PROJECT,
  isRepo: true,
  totalAdditions: 9,
  totalDeletions: 2,
  files: [
    {
      path: 'src/auth/token.ts',
      status: 'modified',
      additions: 3,
      deletions: 2,
      patch: SAMPLE_PATCH_TS,
      unstaged: true,
      source: 'workspace-git',
    },
    {
      path: 'src/auth/scope.ts',
      status: 'added',
      additions: 6,
      deletions: 0,
      patch: SAMPLE_PATCH_ADDED,
      untracked: true,
      source: 'workspace-git',
    },
  ],
}

const SAMPLE_SESSION: ReviewSessionData = {
  sessionId: SESSION,
  cwd: PROJECT,
  sessionSource: 'git-filtered',
  hasConcurrentTurns: true,
  sessionAdditions: 9,
  sessionDeletions: 2,
  sessionFiles: SAMPLE_WORKSPACE.files,
  turns: [
    {
      turnIndex: 1,
      userMessageId: 'u1',
      assistantMessageId: 'a1',
      promptPreview: 'Add scope field and clock skew handling to token validation',
      cwd: PROJECT,
      source: 'git-snapshot',
      concurrent: false,
      createdAt: Date.now() - 60_000,
      files: [SAMPLE_WORKSPACE.files[0]],
      totalAdditions: 3,
      totalDeletions: 2,
    },
    {
      turnIndex: 2,
      userMessageId: 'u2',
      assistantMessageId: 'a2',
      promptPreview: 'Extract scope helper module',
      cwd: PROJECT,
      source: 'git-filtered',
      concurrent: true,
      createdAt: Date.now(),
      files: [SAMPLE_WORKSPACE.files[1]],
      totalAdditions: 6,
      totalDeletions: 0,
    },
  ],
}

const SAMPLE_COMMENTS: ReplyComment[] = [
  {
    id: 'rc-1',
    messageId: null,
    anchorText: 'src/auth/token.ts:L9-L10:D',
    quote: 'src/auth/token.ts:L9-L10:D\n+  const skewMs = 5_000\n+  return payload.exp * 1000 <= now + skewMs',
    text: 'Should skewMs be configurable via options instead of hardcoded?',
    surface: 'code',
  },
]

function StoryHost({
  width,
  comments = [],
  ...props
}: ReviewPanelProps & { width: number; comments?: ReplyComment[] }) {
  useEffect(() => {
    const prev = useChatStore.getState()
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        ...prev.projectSessions,
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: SESSION,
          _sessions: {
            [SESSION]: {
              ...createDefaultPerSessionState(),
              cwd: PROJECT,
              replyComments: comments,
            },
          },
        },
      },
    })
    return () => { useChatStore.setState(prev) }
  }, [comments])

  return (
    <TooltipProvider>
      <div
        style={{ width, height: 640 }}
        className="overflow-hidden rounded-lg border border-border bg-background"
      >
        <ReviewPanel projectPath={PROJECT} sessionId={SESSION} {...props} />
      </div>
    </TooltipProvider>
  )
}

const meta: Meta<typeof StoryHost> = {
  title: 'Review/ReviewPanel',
  component: StoryHost,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof StoryHost>

export const WideTwoColumnSplit: Story = {
  args: {
    width: 1080,
    initialScope: 'workspace',
    initialWorkspaceData: SAMPLE_WORKSPACE,
    initialSessionData: SAMPLE_SESSION,
    comments: SAMPLE_COMMENTS,
  },
}

export const NarrowSingleColumnUnified: Story = {
  args: {
    width: 520,
    initialScope: 'workspace',
    initialWorkspaceData: SAMPLE_WORKSPACE,
    initialSessionData: SAMPLE_SESSION,
  },
}

export const TurnScopeConcurrent: Story = {
  args: {
    width: 980,
    initialScope: 'turn',
    initialWorkspaceData: SAMPLE_WORKSPACE,
    initialSessionData: SAMPLE_SESSION,
  },
}

export const SessionScopeNetDiff: Story = {
  args: {
    width: 980,
    initialScope: 'session',
    initialWorkspaceData: SAMPLE_WORKSPACE,
    initialSessionData: SAMPLE_SESSION,
  },
}

export const LoadingState: Story = {
  args: {
    width: 900,
    initialScope: 'workspace',
    initialWorkspaceData: { root: PROJECT, isRepo: true, files: [], totalAdditions: 0, totalDeletions: 0 },
    initialLoading: true,
  },
}

export const EmptyCleanWorkspace: Story = {
  args: {
    width: 900,
    initialScope: 'workspace',
    initialWorkspaceData: { root: PROJECT, isRepo: true, files: [], totalAdditions: 0, totalDeletions: 0 },
  },
}

export const ErrorWithRetry: Story = {
  args: {
    width: 900,
    initialScope: 'workspace',
    initialWorkspaceData: { root: PROJECT, isRepo: true, files: [], totalAdditions: 0, totalDeletions: 0 },
    initialError: 'Failed to read repository status',
  },
}
