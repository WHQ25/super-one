import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { GitDirtyStatus, WorktreeInfo } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { WorkDirIndicator } from './WorkDirIndicator'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const PROJECT = '/storybook/work-dir'
const HEAD = '6a6563d0deadbeefcafe'
const WT = (slug: string) => `/storybook/.worktrees/${slug}`

const ENTRIES: WorktreeInfo = {
  isWorktree: false,
  currentBranch: 'main',
  entries: [
    { path: PROJECT, branch: 'main', head: HEAD, isMain: true, isCurrent: true },
    { path: WT('long'), branch: 'feat/optimize-skill-and-prompt-for-agent-collaboration-handoff', head: HEAD, isMain: false, isCurrent: false },
    { path: WT('dirty'), branch: 'feat/mobile-live-activity', head: HEAD, isMain: false, isCurrent: false },
    { path: WT('clean'), branch: 'fix/sidebar-hover', head: HEAD, isMain: false, isCurrent: false },
    { path: WT('detached'), branch: '', head: HEAD, isMain: false, isCurrent: false },
  ],
}

const DIRTY: Record<string, GitDirtyStatus | undefined> = {
  [WT('long')]: { files: 67, insertions: 1843, deletions: 212 },
  [WT('dirty')]: { files: 3, insertions: 41, deletions: 0 },
  [WT('detached')]: { files: 1, insertions: 0, deletions: 8 },
}

mockIpc('app', 'getWorktreeInfo', async () => ENTRIES)
mockIpc('app', 'getGitBranches', async () => ['main', 'develop', 'release/2.4'])
mockIpc('app', 'getCheckedOutBranches', async () => ['main'])
mockIpc('app', 'getGitInfo', async (path: unknown) => ({ branch: 'HEAD', dirty: DIRTY[path as string] }))

function Preview({ activePath = null }: { activePath?: string | null }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    useChatStore.getState().ensureSession(PROJECT)
    useChatStore.setState({ activeProject: PROJECT })
    useAppStore.setState({
      currentFolder: PROJECT,
      _worktrees: {
        [PROJECT]: { pendingBaseBranch: null, pendingMode: 'branch', pendingBranchName: '', pendingCarryLocalChanges: false, activePath },
      },
    })
    setReady(true)
    return () => {
      useAppStore.setState({ currentFolder: prevApp.currentFolder, _worktrees: prevApp._worktrees })
      useChatStore.setState(prevChat)
    }
  }, [activePath])
  if (!ready) return null
  return (
    <div className="flex h-96 items-start p-2 text-xs text-muted-foreground">
      <WorkDirIndicator isGitRepo />
    </div>
  )
}

const openPopover = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await new Promise((r) => setTimeout(r, 50))
  canvasElement.querySelector<HTMLElement>('button')?.click()
}

const meta = {
  title: 'Chat/WorkDirIndicator',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Popover listing existing worktrees: long branch wraps to two lines, diff stat sits below, clean rows show nothing. */
export const WorktreeList: Story = { play: openPopover }

/** Same list with the long-branch worktree currently active (check mark on its row). */
export const ActiveLongBranch: Story = { args: { activePath: WT('long') }, play: openPopover }

/** Closed chip only — how the status bar renders it before the user opens the list. */
export const Chip: Story = { args: { activePath: WT('dirty') } }
