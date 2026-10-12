import { useLayoutEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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

function InitialMessagePreview({ provider = 'codex', width = 280 }: { provider?: 'claude' | 'codex'; width?: number }) {
  const [sentTitle, setSentTitle] = useState<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useLayoutEffect(() => {
    const prevChat = useChatStore.getState()
    const prevApp = useAppStore.getState()
    const project = createDefaultProjectState()
    project._activeSessionId = SID
    project._sessions[SID] = { ...createDefaultPerSessionState(), sessionProvider: provider, _historyHydrated: true }
    useChatStore.setState({ activeProject: PROJECT, projectSessions: { [PROJECT]: project }, agentTitles: {} })
    useAppStore.setState({ currentFolder: PROJECT, tmpFolder: null })
    return () => {
      timers.current.forEach(clearTimeout)
      useChatStore.setState(prevChat)
      useAppStore.setState(prevApp)
    }
  }, [provider])

  const send = (text: string) => {
    useChatStore.setState((state) => {
      const project = state.projectSessions[PROJECT]
      return { projectSessions: { ...state.projectSessions, [PROJECT]: { ...project,
        _sessions: { ...project._sessions, [SID]: { ...project._sessions[SID],
          _animateInitialTitle: true,
          messages: [{ id: 'first-message', role: 'user', status: 'complete', providerId: provider, createdAt: '',
            content: [{ type: 'text', text }] }] } },
      } } }
    })
    setSentTitle(text)
    if (!text.startsWith('/')) return
    const syncTitle = (title: string) => useChatStore.setState((state) => {
      const project = state.projectSessions[PROJECT]
      return { projectSessions: { ...state.projectSessions, [PROJECT]: { ...project,
        sessions: [{ sessionId: SID, title, provider, lastActiveAt: '', messageCount: 1 }],
        _sessions: { ...project._sessions, [SID]: { ...project._sessions[SID], _title: title === text ? text : null } },
      } } }
    })
    // Exercise the title returning before the 220 ms fade-out completes.
    timers.current = [setTimeout(() => syncTitle('Untitled'), 50), setTimeout(() => syncTitle(text), 100)]
  }

  return <div className="space-y-3" style={{ width }}>
    <div className="flex gap-2">
      <button disabled={sentTitle !== null} onClick={() => send('/release alpha')}>Send /release alpha</button>
      <button disabled={sentTitle !== null} onClick={() => send('First plain text message')}>Send plain text</button>
    </div>
    <div data-testid="initial-header" className="flex min-w-0 rounded-md bg-card px-3 py-2">
      <SessionTitleAnimated projectPath={PROJECT} sessionId={SID} className="min-w-0 text-xs text-muted-foreground" />
    </div>
    <div data-testid="initial-sidebar" className="bg-sidebar p-1.5 text-sidebar-foreground" data-sidebar-inner>
      {sentTitle && <SessionRow folderPath={PROJECT}
        session={{ sessionId: SID, title: sentTitle, provider, lastActiveAt: '', messageCount: 1 }} {...noop} />}
    </div>
  </div>
}

export const InitialSlashTitle: Story = {
  render: () => <InitialMessagePreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send /release alpha' }))
    await expect(canvas.getByTestId('initial-sidebar').querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'in')
    await waitFor(() => {
      for (const surface of ['initial-header', 'initial-sidebar']) {
        expect(canvas.getByTestId(surface).querySelector('.animated-title-inner')).toHaveTextContent('/release alpha')
        expect(canvas.getByTestId(surface).querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'idle')
      }
    }, { timeout: 3000 })
  },
}
export const InitialSlashTitleClaude: Story = { ...InitialSlashTitle, render: () => <InitialMessagePreview provider="claude" /> }
export const InitialTitleInteractive: Story = { render: () => <InitialMessagePreview /> }
export const InitialSlashTitleNarrowDark: Story = { ...InitialSlashTitle,
  render: () => <InitialMessagePreview width={200} />, globals: { theme: 'dark' } }
export const InitialPlainTextTitle: Story = {
  render: () => <InitialMessagePreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Send plain text' }))
    await expect(canvas.getByTestId('initial-sidebar').querySelector('.animated-title-inner')).toHaveTextContent('First plain text message')
    await expect(canvas.getByTestId('initial-sidebar').querySelector('.animated-title-wrap')).toHaveAttribute('data-phase', 'in')
    await waitFor(() => expect(canvas.getByTestId('initial-header').querySelector('.animated-title-wrap'))
      .toHaveAttribute('data-phase', 'idle'), { timeout: 3000 })
    await waitFor(() => expect(canvas.getByTestId('initial-sidebar').querySelector('.animated-title-wrap'))
      .toHaveAttribute('data-phase', 'idle'), { timeout: 3000 })
  },
}
