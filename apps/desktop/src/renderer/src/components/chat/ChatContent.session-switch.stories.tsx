import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { ChatContent } from './ChatContent'

mockIpc('app', 'resumeSession', async () => null)
mockIpc('app', 'getMediaServerPort', async () => 6007)
mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
mockIpc('app', 'getScheduledSend', async () => null)
mockIpc('app', 'getStartupData', async () => ({ cached: {} }))
mockIpc('app', 'getMcpMetaCache', async () => ({}))
for (const method of ['trace', 'probeMcpIcons']) mockIpc('app', method, async () => undefined)
mockIpc('app', 'getAppSettings', async () => ({ agentPreference: { claude: { drawModInterfaces: false } } }))
mockIpc('app', 'connectClaude', async () => ({ models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }))
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of [
  'listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts',
  'listMcpLibrary', 'listInstalledMcpb', 'listHarnesses', 'queryHarnessSessionRanks',
]) {
  mockIpc('app', method, async () => [])
}
const EMPTY_ACP_RESOURCES = { agents: [], selectedAgentId: null, modelsByAgentId: {}, configByAgentId: {} }
for (const method of ['listAcpAgents', 'refreshAcpModels']) mockIpc('app', method, async () => EMPTY_ACP_RESOURCES)

const PROJECT = '__session_switch__'
const SESSION_IDS = ['session-a', 'session-b', 'session-empty'] as const

function history(label: string): ChatMessage[] {
  return (['user', 'assistant'] as const).map(role => ({
    id: `${label}-${role}`,
    role,
    status: 'complete',
    providerId: role === 'user' ? 'local' : 'claude',
    createdAt: '2026-10-05T00:00:00.000Z',
    content: [{ type: 'text', text: role === 'user'
      ? `Conversation ${label}: please check this session.`
      : `Reply ${label}: only this session's messages should be visible.` }],
  }))
}

function SessionSwitchPreview({ narrow = false }: { narrow?: boolean }) {
  const [ready, setReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeSessionId = useChatStore(state => state.projectSessions[PROJECT]?._activeSessionId)
  useEffect(() => {
    const previous = useChatStore.getState()
    const previousCatalog = useAppStore.getState().harnessCatalog
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        ...previous.projectSessions,
        [PROJECT]: {
          ...createDefaultProjectState(),
          _activeSessionId: SESSION_IDS[0],
          _sessions: Object.fromEntries(SESSION_IDS.map((id, index) => [id, {
            ...createDefaultPerSessionState(),
            cwd: PROJECT,
            sessionProvider: 'claude',
            messages: index < 2 ? history(index === 0 ? 'A' : 'B') : [],
          }])),
        },
      },
    })
    useAppStore.setState({ harnessCatalog: null })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: previousCatalog })
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-3" style={{ width: narrow ? 320 : 760, maxWidth: '100%' }}>
        <div className="flex flex-wrap gap-2">
          {SESSION_IDS.map((id, index) => (
            <Button
              key={id}
              size="sm"
              variant={activeSessionId === id ? 'default' : 'outline'}
              data-session-switch={id}
              onClick={() => void useChatStore.getState().switchSession(id)}
            >
              {index < 2 ? `Session ${index === 0 ? 'A' : 'B'}` : 'Empty session'}
            </Button>
          ))}
        </div>
        <div data-testid="session-switch-preview" className="@container flex h-[560px] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
          {ready && <ChatContent scrollViewportRef={scrollRef} foreground={false} />}
        </div>
      </div>
    </TooltipProvider>
  )
}

const meta = { title: 'Chat/Session Switching', component: SessionSwitchPreview, parameters: { layout: 'padded' } } satisfies Meta<typeof SessionSwitchPreview>
export default meta
type Story = StoryObj<typeof meta>

export const RepeatedSwitches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Conversation A: please check this session.')
    for (const label of ['Session B', 'Session A', 'Empty session', 'Session A', 'Session B']) {
      await userEvent.click(canvas.getByRole('button', { name: label }))
      await waitFor(() => {
        expect(canvasElement.querySelectorAll('[data-transcript-frame]')).toHaveLength(1)
        expect(canvasElement.querySelectorAll('[data-message-id]')).toHaveLength(label === 'Empty session' ? 0 : 2)
        expect(canvas.getAllByTestId('composer-slot')).toHaveLength(1)
        for (const session of ['A', 'B']) {
          const text = `Conversation ${session}: please check this session.`
          if (label === `Session ${session}`) expect(canvas.getByText(text)).toBeInTheDocument()
          else expect(canvas.queryByText(text)).toBeNull()
        }
      })
    }
  },
}
export const Narrow: Story = { args: { narrow: true }, play: RepeatedSwitches.play }
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' }, play: RepeatedSwitches.play }
