import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import type { ChatMessage, GitInfoResult } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { ChatStatusBar } from './ChatStatusBar'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const PROJECT = '/storybook/status-bar'

const XCODE_LICENSE_ERROR =
  "You have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license."

/** Per-story git answer; the component reads it once on mount and again when the chip is clicked. */
let gitResult: GitInfoResult = null

interface MonitorSeed {
  description: string
  command: string
  count?: number
}

function monitorMessage(seed: MonitorSeed): ChatMessage {
  const count = seed.count ?? 1
  return {
    id: 'a1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'grok-build',
    content: Array.from({ length: count }, (_, index) => {
      const id = index === 0 ? 'mon' : `mon-${index + 1}`
      const description = index === 0 ? seed.description : 'watch the test log'
      const command = index === 0 ? seed.command : 'bun test --watch'
      return {
        type: 'tool_use' as const,
        toolName: 'Monitor',
        toolUseId: id,
        input: JSON.stringify({ description, command }),
        status: 'complete' as const,
        parentToolUseId: null,
      }
    }),
  }
}

function seedMonitor(seed: MonitorSeed | undefined): void {
  const store = useChatStore.getState()
  const project = store.projectSessions[PROJECT]
  const sid = project?._activeSessionId
  const session = sid ? project?._sessions[sid] : undefined
  if (!project || !sid || !session || !seed) return
  const count = seed.count ?? 1
  const taskProgress = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = index === 0 ? 'mon' : `mon-${index + 1}`
    return [id, {
      description: index === 0 ? seed.description : 'watch the test log',
      taskId: `task-${id}`,
      completed: false,
      totalTokens: 0,
      toolUses: 0,
      durationMs: 0,
      toolHistory: [],
    }]
  }))
  useChatStore.setState({
    projectSessions: {
      ...store.projectSessions,
      [PROJECT]: {
        ...project,
        _sessions: {
          ...project._sessions,
          [sid]: {
            ...session,
            status: 'background',
            messages: [monitorMessage(seed)],
            taskProgress,
          },
        },
      },
    },
  })
}

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'getGitInfo', async () => gitResult)
mockIpc('app', 'getGitBranches', async () => ['main', 'develop'])
mockIpc('app', 'getCheckedOutBranches', async () => ['main'])
mockIpc('app', 'getWorktreeInfo', async () => ({ isWorktree: false, currentBranch: 'main', entries: [] }))
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts']) mockIpc('app', method, async () => [])

function Preview({ git, narrow = false, monitor }: { git: GitInfoResult; narrow?: boolean; monitor?: MonitorSeed }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    gitResult = git
    const prevApp = useAppStore.getState()
    const prevChat = useChatStore.getState()
    useChatStore.getState().ensureSession(PROJECT)
    useChatStore.setState({ activeProject: PROJECT })
    seedMonitor(monitor)
    useAppStore.setState({ experimentalRemoteNodesEnabled: true, currentFolder: PROJECT, _worktrees: {} })
    setReady(true)
    return () => {
      useAppStore.setState({
        experimentalRemoteNodesEnabled: prevApp.experimentalRemoteNodesEnabled,
        currentFolder: prevApp.currentFolder,
        _worktrees: prevApp._worktrees,
      })
      useChatStore.setState(prevChat)
    }
  }, [git, monitor])
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

/** Folder is a repo: the one chip shows the branch and the dirty dot. */
export const Repo: Story = { args: { git: { branch: 'main', dirty: { files: 3, insertions: 41, deletions: 7 } } } }

/** Folder is not a repo (`null`): the one chip says Git is not initialized. */
export const NotARepo: Story = { args: { git: null } }

/**
 * git itself failed (`branch: null`) — e.g. the Xcode license was reset by a
 * macOS update. The bar must not offer init; it shows the warning chip whose
 * tooltip carries git's stderr, and clicking it retries.
 */
export const GitUnavailable: Story = { args: { git: { branch: null, error: XCODE_LICENSE_ERROR } } }

/** Compact width collapses the chip to its icon; the tooltip still explains. */
export const GitUnavailableNarrow: Story = { args: { git: { branch: null, error: XCODE_LICENSE_ERROR }, narrow: true } }

const runningMonitor = {
  description: 'watch the build log',
  command: 'tail -f build.log',
}

/** A live Grok monitor stays on the status bar after the turn goes idle. */
export const RunningMonitor: Story = {
  args: { git: { branch: 'main', dirty: undefined }, monitor: runningMonitor },
}

/** Two watches share one chip. */
export const RunningMonitors: Story = {
  args: { git: { branch: 'main', dirty: undefined }, monitor: { ...runningMonitor, count: 2 } },
}

/** Narrow width keeps the activity icon and drops the label. */
export const RunningMonitorNarrow: Story = {
  args: { git: { branch: 'main', dirty: undefined }, monitor: runningMonitor, narrow: true },
}

/** A long description stays on one line in the chip. */
export const RunningMonitorLongTitle: Story = {
  args: {
    git: { branch: 'main', dirty: undefined },
    monitor: {
      description: 'watch the production deploy log for the desktop release workflow',
      command: 'tail -f /var/log/superone-release.log',
    },
  },
}

export const RunningMonitorDark: Story = {
  args: { git: { branch: 'main', dirty: undefined }, monitor: runningMonitor },
  globals: { theme: 'dark' },
}

/** Opening the chip shows the live Monitor tool, including its stop control when the host allows it. */
export const RunningMonitorExpanded: Story = {
  args: { git: { branch: 'main', dirty: undefined }, monitor: runningMonitor },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button[title="Monitor"]')?.click()
  },
}
