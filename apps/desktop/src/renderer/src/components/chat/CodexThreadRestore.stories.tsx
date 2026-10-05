import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW, useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ChatContent } from './ChatContent'
import { codexThreadRestoreFixture } from './codex-thread-restore-fixture'

const projectPath = '__codex_thread_restore__'
const sessionId = 'codex-thread-restore'

mockIpc('app', 'getMediaServerPort', async () => 6006)

function RestoredThread({ width = 760 }: { width?: number }) {
  const [ready, setReady] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previousChat = useChatStore.getState()
    const previousRealtime = useCodexRealtimeViewStore.getState()
    const { messages, timeline } = codexThreadRestoreFixture()
    mockIpc('agent', 'loadRealtimeTimeline', async () => timeline)
    mockIpc('agent', 'getRealtimeTimeline', async () => timeline)
    mockIpc('agent', 'prewarm', async () => undefined)
    mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
    mockIpc('app', 'connectCodex', async () => ({ models: [], prompts: [] }))
    mockIpc('app', 'codexListAccounts', async () => [])
    mockIpc('app', 'codexListModels', async () => [])
    mockIpc('app', 'codexGetGoal', async () => null)
    for (const method of ['probeMcpIcons', 'trace']) mockIpc('app', method, async () => undefined)
    mockIpc('app', 'getScheduledSend', async () => null)
    mockIpc('app', 'getGitInfo', async () => null)
    mockIpc('app', 'getAppSettings', async () => ({ agentPreference: { claude: {}, codex: {}, acp: {} } }))
    mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
    mockIpc('app', 'getMcpMetaCache', async () => ({}))
    for (const method of ['listMcpLibrary', 'listInstalledMcpb', 'listPlatforms', 'listCredentials', 'listBindings']) {
      mockIpc('app', method, async () => [])
    }
    const session = createDefaultPerSessionState()
    Object.assign(session, { messages, sessionProvider: 'codex', preferredProvider: 'codex', _historyHydrated: true })
    useChatStore.setState({
      activeProject: projectPath,
      projectSessions: {
        ...previousChat.projectSessions,
        [projectPath]: { ...createDefaultProjectState(), _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
      },
    })
    useCodexRealtimeViewStore.setState({
      sessions: {
        ...previousRealtime.sessions,
        [sessionId]: { ...EMPTY_CODEX_REALTIME_SESSION_VIEW, ...timeline, view: 'thread', loadStatus: 'loaded' },
      },
    })
    setReady(true)
    return () => {
      useChatStore.setState(previousChat)
      useCodexRealtimeViewStore.setState(previousRealtime)
    }
  }, [])
  return (
    <TooltipProvider>
      <div className="@container flex h-[640px] min-w-0 max-w-full flex-col rounded-lg border bg-card" style={{ width }}>
        {ready && <ChatContent scrollViewportRef={viewportRef} foreground={false} />}
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Chat/Codex Thread Restore',
  component: RestoredThread,
  globals: { harness: 'codex' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RestoredThread>
export default meta
type Story = StoryObj<typeof meta>

/** Latest reply stays after compaction; expanding history reveals the steered reply once. */
export const CompactionAndSteer: Story = {}
export const NarrowDarkChinese: Story = {
  args: { width: 320 }, globals: { theme: 'dark', locale: 'zh' },
}
