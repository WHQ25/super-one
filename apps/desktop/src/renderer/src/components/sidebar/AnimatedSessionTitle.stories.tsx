import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { SessionTitleAnimated } from './AnimatedSessionTitle'
import { SessionRow } from './SessionRow'

const PROJECT = '/storybook/voice-titles'
const SID = 'voice-titles'
const noop = { onSwitchSession: () => {}, onPinSession: () => {}, onHideSession: () => {},
  onRenameSession: () => {}, onDeleteSession: () => {} }

function Preview({ title, restored = false, width = 280 }: { title?: string; restored?: boolean; width?: number }) {
  useLayoutEffect(() => {
    const prevChat = useChatStore.getState()
    const prevApp = useAppStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = SID
    project._sessions[SID] = { ...createDefaultPerSessionState(), sessionProvider: 'codex',
      _title: restored ? title ?? null : null, _historyHydrated: true,
      messages: [{ id: 'backing-prompt', role: 'user', status: 'complete', providerId: 'codex', createdAt: '',
        content: [{ type: 'text', text: 'You are the coding agent behind a voice conversation' }] }] }
    project.sessions = title ? [{ sessionId: SID, title, lastActiveAt: '', messageCount: 1, provider: 'codex' }] : []
    useChatStore.setState({ activeProject: PROJECT, projectSessions: { [PROJECT]: project }, agentTitles: {} })
    useAppStore.setState({ currentFolder: PROJECT, tmpFolder: null })
    return () => { useChatStore.setState(prevChat); useAppStore.setState(prevApp) }
  }, [title, restored])

  return <div className="space-y-2" style={{ width }}>
    <div className="flex min-w-0 rounded-md bg-card px-3 py-2">
      <SessionTitleAnimated projectPath={PROJECT} sessionId={SID} className="min-w-0 text-xs text-muted-foreground" />
    </div>
    <div className="bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      <SessionRow folderPath={PROJECT} session={{ sessionId: SID, title: title ?? 'You are the coding agent behind a voice conversation',
        lastActiveAt: '', messageCount: 1, provider: 'codex' }} {...noop} />
    </div>
  </div>
}

const meta = { title: 'Sidebar/Session title sources', component: SessionTitleAnimated,
  parameters: { layout: 'centered' }, args: { projectPath: PROJECT, sessionId: SID },
} satisfies Meta<typeof SessionTitleAnimated>
export default meta
type Story = StoryObj<typeof meta>

export const SavedVoiceTitle: Story = { render: () => <Preview title="Plan the next release" /> }
export const RestoredVoiceTitle: Story = { render: () => <Preview title="Plan the next release" restored /> }
export const MessageFallback: Story = { render: () => <Preview /> }
export const NarrowLongTitle: Story = { render: () => <Preview width={200}
  title="Investigate voice session recovery and keep titles consistent across all windows" restored /> }
