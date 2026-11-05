import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, within } from 'storybook/test'
import type { CodexReviewTarget } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useChatStore } from '@/stores/chat'
import { ReviewPanel } from './ReviewPanel'

const PROJECT = 'remote:office:/srv/app'
const WORKTREE = '/home/node/.worktrees/app/task-7af08a26'
const ROUTED_WORKTREE = `remote:office:${WORKTREE}`
const BRANCHES = ['task/7af08a26', 'main', 'feature/a-long-branch-name-for-reviewing-remote-worktree-routing']
const COMMITS = [
  { sha: 'abc123456789', message: 'Keep remote worktree Git reads on their owning node' },
  { sha: 'def456789abc', message: 'Restore session settings' },
]

function Preview({
  mode = 'branch',
  state = 'ready',
  narrow = false,
}: {
  mode?: 'branch' | 'commit'
  state?: 'ready' | 'loading' | 'empty' | 'error'
  narrow?: boolean
}) {
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<CodexReviewTarget | null>(null)
  useEffect(() => {
    const previous = useChatStore.getState()
    const read = async <T,>(path: unknown, result: T, empty: T): Promise<T> => {
      if (state === 'loading') return new Promise<T>(() => {})
      if (state === 'error') throw new Error('Node unavailable')
      return path === ROUTED_WORKTREE && state !== 'empty' ? result : empty
    }
    mockIpc('app', 'getGitBranches', (path) => read(path, BRANCHES, []))
    mockIpc('app', 'getGitInfo', (path) => read(path, { branch: 'task/7af08a26' }, { branch: '' }))
    mockIpc('app', 'listGitMentionRefs', (path) => read(path, {
      ok: true,
      refs: COMMITS.map((commit) => ({ kind: 'commit', id: commit.sha, label: commit.sha.slice(0, 7), detail: commit.message })),
    }, { ok: true, refs: [] }))
    previous.ensureSession(PROJECT)
    useChatStore.setState((store) => {
      const project = store.projectSessions[PROJECT]
      const sid = project._activeSessionId!
      return {
        activeProject: PROJECT,
        startCodexReview: setSelected,
        setShowReviewPanel: () => {},
        projectSessions: {
          ...store.projectSessions,
          [PROJECT]: {
            ...project,
            reviewPanelInitialMode: mode,
            _sessions: {
              ...project._sessions,
              [sid]: { ...project._sessions[sid], cwd: WORKTREE, _worktreePath: WORKTREE },
            },
          },
        },
      }
    })
    setReady(true)
    return () => { useChatStore.setState(previous, true) }
  }, [mode, state])
  return (
    <div className="relative text-foreground" style={{ width: narrow ? 300 : 560, height: 380, maxWidth: '100%' }}>
      <div className="absolute bottom-8 inset-x-0">{ready && <ReviewPanel key={`${mode}-${state}`} />}</div>
      {selected && <output className="absolute bottom-0 text-xs">Selected: {JSON.stringify(selected)}</output>}
    </div>
  )
}

const meta = {
  title: 'Chat/ReviewPanel',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

export const RemoteWorktreeBranches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('button', { name: 'main' })).resolves.toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'task/7af08a26' })).not.toBeInTheDocument()
  },
}
export const RemoteWorktreeCommits: Story = {
  args: { mode: 'commit' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('button', { name: /Keep remote worktree Git reads/ })).resolves.toBeVisible()
  },
}
export const Loading: Story = { args: { state: 'loading' } }
export const Empty: Story = { args: { state: 'empty' } }
export const UnavailableNode: Story = { args: { state: 'error' } }
export const NarrowLongBranches: Story = { args: { narrow: true } }
