import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { GitInfoResult } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { ChatStatusBar } from './ChatStatusBar'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const PROJECT = '/storybook/status-bar'

const XCODE_LICENSE_ERROR =
  "You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license."

/** Per-story git answer; the component reads it once on mount and again when the chip is clicked. */
let gitResult: GitInfoResult = null

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'getGitInfo', async () => gitResult)
mockIpc('app', 'getGitBranches', async () => ['main', 'develop'])
mockIpc('app', 'getCheckedOutBranches', async () => ['main'])
mockIpc('app', 'getWorktreeInfo', async () => ({ isWorktree: false, currentBranch: 'main', entries: [] }))
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts']) mockIpc('app', method, async () => [])

function Preview({ git, narrow = false }: { git: GitInfoResult; narrow?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    gitResult = git
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    useChatStore.getState().ensureSession(PROJECT)
    useChatStore.setState({ activeProject: PROJECT })
    useAppStore.setState({ currentFolder: PROJECT, _worktrees: {} })
    setReady(true)
    return () => {
      useAppStore.setState({ currentFolder: prevApp.currentFolder, _worktrees: prevApp._worktrees })
      useChatStore.setState(prevChat)
    }
  }, [git])
  if (!ready) return null
  return (
    <div className="@container rounded-lg border border-border bg-background py-2" style={{ width: narrow ? 300 : 640, maxWidth: '100%' }}>
      <ChatStatusBar />
    </div>
  )
}

const meta = {
  title: 'Chat/ChatStatusBar',
  component: Preview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

/** Folder is a repo: branch chip with the dirty summary. */
export const Repo: Story = { args: { git: { branch: 'main', dirty: { files: 3, insertions: 41, deletions: 7 } } } }

/** Folder is not a repo (`null`): the bar offers "Init Git". */
export const NotARepo: Story = { args: { git: null } }

/**
 * git itself failed (`branch: null`) — e.g. the Xcode license was reset by a
 * macOS update. The bar must not offer init; it shows the warning chip whose
 * tooltip carries git's stderr, and clicking it retries.
 */
export const GitUnavailable: Story = { args: { git: { branch: null, error: XCODE_LICENSE_ERROR } } }

/** Compact width collapses the chip to its icon; the tooltip still explains. */
export const GitUnavailableNarrow: Story = { args: { git: { branch: null, error: XCODE_LICENSE_ERROR }, narrow: true } }
