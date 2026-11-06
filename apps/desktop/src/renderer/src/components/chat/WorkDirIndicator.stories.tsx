import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useState } from 'react'
import type { GitDirtyStatus, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'
import { parseRemoteProjectKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useMultiHostSidebarStore } from '@/stores/multi-host-sidebar'
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

const MANY_ENTRIES: WorktreeInfo = {
  ...ENTRIES,
  entries: [...ENTRIES.entries, ...Array.from({ length: 8 }, (_, index) => ({
    path: WT(`extra-${index}`), branch: `feat/worktree-${index + 1}`, head: HEAD, isMain: false, isCurrent: false,
  }))],
}
const BRANCHES = ['main', 'develop', 'release/2.4', ...Array.from({ length: 15 }, (_, index) => `feat/branch-${index + 1}`)]
let worktreeResult: WorktreeInfo = ENTRIES
let remotePreview = false
let branchesState: 'ready' | 'loading' | 'error' = 'ready'

const DIRTY: Record<string, GitDirtyStatus | undefined> = {
  [WT('long')]: { files: 67, insertions: 1843, deletions: 212 },
  [WT('dirty')]: { files: 3, insertions: 41, deletions: 0 },
  [WT('detached')]: { files: 1, insertions: 0, deletions: 8 },
}

mockIpc('app', 'getWorktreeInfo', async () => worktreeResult)
mockIpc('app', 'getGitBranches', async () => {
  if (branchesState === 'loading') return new Promise(() => {})
  if (branchesState === 'error') return { local: [], error: 'Could not load branches. Reopen to retry.' }
  return { local: BRANCHES }
})
mockIpc('app', 'getCheckedOutBranches', async () => ['main'])
mockIpc('app', 'getGitInfo', async (path: unknown) => {
  const remote = parseRemoteProjectKey(path as string)
  if (remotePreview && !remote) return { branch: null, error: 'Worktree status must be read on its node' }
  const hostPath = remote?.path ?? path as string
  if (hostPath === WT('unavailable')) throw new Error('Checkout unavailable')
  return hostPath === PROJECT
    ? { branch: 'main', dirty: { files: 2, insertions: 10, deletions: 1 } }
    : { branch: 'HEAD', dirty: DIRTY[hostPath] }
})

function Preview({
  activePath = null,
  isGitRepo = true,
  empty = false,
  many = false,
  branchState = 'ready',
  pendingBase = null,
  pendingMode = 'branch',
  started = false,
  narrow = false,
  experiment = true,
  remote = false,
  hostLabel = null,
  frameClass,
}: {
  activePath?: string | null
  isGitRepo?: boolean
  empty?: boolean
  many?: boolean
  branchState?: 'ready' | 'loading' | 'error'
  pendingBase?: string | null
  pendingMode?: WorktreeMode
  started?: boolean
  narrow?: boolean
  /** Remote-nodes experiment. Off shows the pre-branch worktree chip. */
  experiment?: boolean
  remote?: boolean
  /** Environment name shown on the chip. Long names shrink before the branch. */
  hostLabel?: string | null
  frameClass?: string
}) {
  const projectPath = remote ? remoteProjectKey('office', PROJECT) : PROJECT
  const [ready, setReady] = useState(false)
  useEffect(() => {
    worktreeResult = empty
      ? { ...ENTRIES, entries: ENTRIES.entries.filter((entry) => entry.isMain) }
      : many ? MANY_ENTRIES : ENTRIES
    branchesState = branchState
    remotePreview = remote
    if (remote && !empty) worktreeResult = {
      ...worktreeResult,
      entries: [...worktreeResult.entries, {
        path: WT('unavailable'), branch: 'task/unavailable', head: HEAD, isMain: false, isCurrent: false,
      }],
    }
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    useChatStore.getState().ensureSession(projectPath)
    useChatStore.setState({ activeProject: projectPath })
    if (started) {
      const sid = useChatStore.getState().projectSessions[projectPath]?._activeSessionId
      if (sid) {
        useChatStore.setState((state) => {
          const project = state.projectSessions[projectPath]
          const session = project?._sessions[sid]
          if (!project || !session) return {}
          return {
            projectSessions: {
              ...state.projectSessions,
              [projectPath]: {
                ...project,
                _sessions: {
                  ...project._sessions,
                  [sid]: {
                    ...session,
                    _worktreePath: activePath,
                    _gitBranch: 'feat/mobile-live-activity',
                    messages: [{
                      id: 'started',
                      role: 'user',
                      status: 'complete',
                      content: [{ type: 'text', text: 'Continue on this worktree' }],
                      createdAt: '2026-10-09T00:00:00.000Z',
                      providerId: 'claude',
                    }],
                  },
                },
              },
            },
          }
        })
      }
    }
    useAppStore.setState({
      experimentalRemoteNodesEnabled: experiment,
      currentFolder: projectPath,
      _worktrees: {
        [projectPath]: { pendingBaseBranch: pendingBase, pendingMode, pendingBranchName: '', pendingCarryLocalChanges: false, activePath },
      },
    })
    const prevHosts = useMultiHostSidebarStore.getState().environments
    if (hostLabel || remote) {
      useMultiHostSidebarStore.setState({
        environments: [{
          environmentId: remote ? 'office' : 'local',
          connectionId: remote ? 'office' : 'local',
          label: hostLabel ?? 'Office',
          kind: remote ? 'cli-node' : 'local',
          connection: 'connected',
          projectsStatus: 'ready',
          projectsError: null,
          checkouts: [],
        }],
      })
    }
    setReady(true)
    return () => {
      remotePreview = false
      useAppStore.setState({
        experimentalRemoteNodesEnabled: prevApp.experimentalRemoteNodesEnabled,
        currentFolder: prevApp.currentFolder,
        _worktrees: prevApp._worktrees,
      })
      branchesState = 'ready'
      useChatStore.setState(prevChat)
      useMultiHostSidebarStore.setState({ environments: prevHosts })
    }
  }, [activePath, empty, many, branchState, experiment, hostLabel, pendingBase, pendingMode, projectPath, remote, started])
  if (!ready) return null
  return (
    <div className={frameClass ?? (narrow ? 'w-36 p-2 text-xs text-muted-foreground' : 'flex h-[760px] items-end p-2 text-xs text-muted-foreground')}>
      <WorkDirIndicator compact={narrow} isGitRepo={isGitRepo} />
    </div>
  )
}

const openPopover = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await waitFor(() => expect(canvasElement.querySelector('[data-slot="popover-trigger"]')).toBeTruthy())
  await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-slot="popover-trigger"]')!)
}

const openWorktreeTab = async (context: { canvasElement: HTMLElement }) => {
  await openPopover(context)
  const body = within(context.canvasElement.ownerDocument.body)
  await userEvent.click(await body.findByRole('tab', { name: /Worktree|工作树/ }))
}

const meta = {
  title: 'Chat/WorkDirIndicator',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Checkout tab: local branches and New Branch. */
export const CheckoutBranches: Story = { play: openPopover }

/** Same checkout tab in dark. */
export const CheckoutBranchesDark: Story = { play: openPopover, globals: { theme: 'dark' } }

/** Worktree tab: current branch selected as base, branch picker collapsed. */
export const WorktreeList: Story = { play: openWorktreeTab }

/** Remote rows use node-qualified paths; one failed checkout does not hide the others. */
export const RemoteWorktreeList: Story = {
  args: { remote: true },
  play: async (context) => {
    await openWorktreeTab(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await waitFor(() => {
      const dirty = within(body.getByRole('button', { name: /feat\/mobile-live-activity/ }))
      expect(dirty.getByText('3 files')).toBeTruthy()
      expect(dirty.getByText('+41')).toBeTruthy()
      expect(body.getByRole('button', { name: /fix\/sidebar-hover/ })).toHaveTextContent('clean')
      expect(body.getByRole('button', { name: /task\/unavailable/ })).not.toHaveTextContent(/clean|files/)
    })
  },
}

export const RemoteWorktreeListDark: Story = { ...RemoteWorktreeList, globals: { theme: 'dark' } }
export const RemoteWorktreeListNarrow: Story = { ...RemoteWorktreeList, args: { remote: true, narrow: true } }
export const RemoteWorktreeListClassic: Story = { args: { remote: true, experiment: false }, play: openPopover }

/** Five worktrees fit before the faded scrolling edge. */
export const ManyWorktrees: Story = { args: { many: true }, play: openWorktreeTab }
export const ManyWorktreesDark: Story = { ...ManyWorktrees, globals: { theme: 'dark' } }
export const WorktreeChinese: Story = { args: { many: true }, globals: { locale: 'zh' }, play: openWorktreeTab }
export const WorktreeNarrow: Story = {
  args: { many: true, frameClass: 'flex h-[760px] w-80 items-end p-2 text-xs text-muted-foreground' },
  play: openWorktreeTab,
}

const expandBase = async (context: { canvasElement: HTMLElement }) => {
  await openWorktreeTab(context)
  const body = within(context.canvasElement.ownerDocument.body)
  const base = await body.findByRole('button', { name: 'Base branch: main' })
  await userEvent.click(base)
  const branches = context.canvasElement.ownerDocument.querySelector('[data-slot="workdir-base-list"]')!
  expect(base.compareDocumentPosition(branches) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

export const ExpandedBranches: Story = { args: { many: true }, play: expandBase }
export const ExpandedBranchesDark: Story = { ...ExpandedBranches, globals: { theme: 'dark' } }
export const BranchesLoading: Story = { args: { branchState: 'loading' }, play: expandBase }
export const BranchesError: Story = { args: { branchState: 'error' }, play: expandBase }

export const FilterBranches: Story = {
  args: { many: true },
  play: async (context) => {
    await expandBase(context)
    const body = within(context.canvasElement.ownerDocument.body)
    const search = body.getByPlaceholderText('Search branches…')
    await userEvent.type(search, 'RELEASE')
    const list = within(context.canvasElement.ownerDocument.querySelector('[data-slot="workdir-base-list"]') as HTMLElement)
    expect(list.queryByRole('button', { name: 'develop' })).toBeNull()
    await userEvent.click(list.getByRole('button', { name: 'release/2.4' }))
    expect(body.getByRole('button', { name: 'Base branch: release/2.4' })).toHaveAttribute('aria-expanded', 'false')
    expect(body.getByPlaceholderText('Search worktrees…')).toHaveValue('')
  },
}

export const BranchesNoMatches: Story = {
  play: async (context) => {
    await expandBase(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await userEvent.type(body.getByPlaceholderText('Search branches…'), 'missing-branch')
    const list = within(context.canvasElement.ownerDocument.querySelector('[data-slot="workdir-base-list"]') as HTMLElement)
    expect(list.getByText('No matches')).toBeTruthy()
  },
}

export const FilterWorktrees: Story = {
  args: { many: true },
  play: async (context) => {
    await openWorktreeTab(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await userEvent.type(body.getByPlaceholderText('Search worktrees…'), 'sidebar')
    expect(body.getByRole('button', { name: /fix\/sidebar-hover/ })).toBeTruthy()
    expect(body.queryByRole('button', { name: /feat\/mobile-live-activity/ })).toBeNull()
  },
}

/** Worktree tab with no linked worktrees yet. */
export const EmptyWorktrees: Story = { args: { empty: true }, play: openWorktreeTab }

/** Folder is not a repository: the worktree tab is disabled and init sits on the checkout tab. */
export const NotARepo: Story = { args: { isGitRepo: false }, play: openPopover }

/** Same list with the long-branch worktree currently active (check mark on its row). */
export const ActiveLongBranch: Story = { args: { activePath: WT('long') }, play: openPopover }

/** Closed chip only — environment, then the worktree branch. */
export const Chip: Story = { args: { activePath: WT('dirty') } }

/** A long hostname yields first. The branch stays whole inside a narrow status bar. */
export const LongNames: Story = {
  args: {
    activePath: WT('long'),
    hostLabel: '25s-MacBook-Pro.local',
    frameClass: 'w-64 p-2 text-xs text-muted-foreground',
  },
}

/** Flag off: the pre-branch worktree chip, with no environment row. */
export const ClassicChip: Story = { args: { experiment: false, activePath: WT('dirty') } }

/** Chip names the pending worktree before any files exist. */
export const PendingCreateChip: Story = { args: { pendingBase: 'main' } }

/** Attach shows the branch the worktree will check out. */
export const PendingAttachChip: Story = { args: { pendingBase: 'develop', pendingMode: 'attach' } }

/** Detach shows the base branch with a Detached tag. */
export const PendingDetachChip: Story = { args: { pendingBase: 'release/2.4', pendingMode: 'detach' } }

/** A session that already has messages stays on its worktree. */
export const StartedWorktreeChip: Story = { args: { activePath: WT('dirty'), started: true }, play: openPopover }

/** A started local session omits the machine hint. Its worktree tab only forks. */
export const StartedLocal: Story = {
  args: { started: true },
  play: async ({ canvasElement }) => {
    await openPopover({ canvasElement })
    const body = within(canvasElement.ownerDocument.body)
    expect(body.queryByText(/This session stays on/)).toBeNull()
    expect(body.getByPlaceholderText('Search or create branch…')).toBeTruthy()
    await userEvent.click(body.getByRole('tab', { name: 'Worktree' }))
    await waitFor(() => {
      expect(body.queryByPlaceholderText('Search worktrees…')).toBeNull()
      expect(body.getByText('Fork to new worktree')).toBeTruthy()
      expect(body.getByRole('checkbox', { name: /carry local changes/i })).toBeChecked()
    })
    await userEvent.click(body.getByRole('tab', { name: 'Local' }))
    await waitFor(() => {
      expect(body.getByPlaceholderText('Search or create branch…')).toBeTruthy()
    })
  },
}

/** The closed chip in a narrow composer. */
export const Narrow: Story = { args: { narrow: true, activePath: WT('long') } }
