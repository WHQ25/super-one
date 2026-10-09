import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type PerSessionState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatComposerShell } from './ChatComposerShell'
import { plainTextToTiptapDoc } from './chat-input/plainTextToTiptapDoc'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { Toaster } from 'sonner'
import i18n from 'i18next'
import { expect, userEvent, waitFor, within } from 'storybook/test'

mockIpc('app', 'getMediaServerPort', async () => 6006)
mockIpc('app', 'getGitInfo', async () => null)
mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
for (const method of ['listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts']) mockIpc('app', method, async () => [])
mockIpc('app', 'getScheduledSend', async () => null)

const projectPath = '/storybook/shared-draft'
const sessionId = 'draft-preview'
function updateDraft(fields: Partial<PerSessionState>) {
  useChatStore.setState((state) => {
    const project = state.projectSessions[projectPath]
    if (!project) return state
    return { projectSessions: { ...state.projectSessions, [projectPath]: {
      ...project, _sessions: { ...project._sessions, [sessionId]: { ...project._sessions[sessionId], ...fields } },
    } } }
  })
}

function DraftPreview({ narrow = false, busy = false, failure = false, attachmentFailure }: { narrow?: boolean; busy?: boolean; failure?: boolean; attachmentFailure?: 'invalid' | 'save' }) {
  const [ready, setReady] = useState(false)
  const [text, setText] = useState('Review the mobile draft layout and keep desktop edits visible.\nInclude the saved attachment and inline references.')
  const locked = useChatStore((state) => !!state.projectSessions[projectPath]?._sessions[sessionId]?.draftRemoteDeviceId)
  useEffect(() => {
    const previous = useChatStore.getState()
    const oldCatalog = useAppStore.getState().harnessCatalog
    const environment = window.environment
    const timer = setTimeout(() => {
      const project = createDefaultProjectState()
      const session = createDefaultPerSessionState()
      Object.assign(session, { draftId: 'shared-draft', draftText: text, draftJson: plainTextToTiptapDoc(text), draftRemoteDeviceId: attachmentFailure ? null : 'phone', ...(attachmentFailure ? { attachments: [{ ...PNG_ATTACHMENT, id: 'image', ...(attachmentFailure === 'invalid' ? { base64: 'invalid' } : {}) }] } : {}) })
      useChatStore.setState({ activeProject: projectPath, projectSessions: {
        ...useChatStore.getState().projectSessions,
        [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
      } })
      if (attachmentFailure === 'save') useChatStore.setState({ sendMessage: async () => { updateDraft({ attachments: [] }); throw new Error('Attachment: Could not save picture.png. Retry the message.') } })
      useAppStore.setState({ harnessCatalog: null })
      window.environment = { ...environment, disconnectDraft: async () => {
        if (busy) return new Promise<void>(() => {})
        if (failure) throw new Error('Could not disconnect draft. Try again.')
        updateDraft({ draftRemoteDeviceId: null })
      } }
      setReady(true)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.environment = environment
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: oldCatalog })
    }
  }, [busy, failure, attachmentFailure])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    <label className="mb-5 block text-sm text-muted-foreground">Mobile draft
      <textarea aria-label="Mobile draft" className="mt-2 block w-full rounded-md border p-2 text-foreground" value={text} disabled={!locked}
        onChange={(event) => {
          setText(event.target.value)
          updateDraft({ draftText: event.target.value, draftJson: plainTextToTiptapDoc(event.target.value) })
        }} />
    </label>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

const meta = { title: 'Chat/ChatComposerShell', component: ChatComposerShell, args: { showTodoPopup: false }, parameters: { layout: 'padded' } } satisfies Meta<typeof ChatComposerShell>
export default meta
type Story = StoryObj<typeof meta>
export const SharedDraft: Story = { render: () => <DraftPreview /> }
export const NarrowDraft: Story = { render: () => <DraftPreview narrow /> }
export const Disconnecting: Story = { render: () => <DraftPreview busy /> }
export const DisconnectError: Story = { render: () => <DraftPreview failure /> }

export const InvalidAttachment: Story = { render: () => <DraftPreview attachmentFailure="invalid" /> }
export const AttachmentSaveRetry: Story = { render: () => <DraftPreview attachmentFailure="save" narrow /> }

type ControlOutcome = 'ok' | 'busy' | 'error'

/** Settle a mocked Disconnect/Reconnect: change hands, hang, or fail. */
function settle(outcome: ControlOutcome, apply: () => void): Promise<void> {
  if (outcome === 'busy') return new Promise<void>(() => {})
  if (outcome === 'error') return Promise.reject(new Error('The other computer is offline.'))
  apply()
  return Promise.resolve()
}

/**
 * A session another desktop started on this computer: the composer gives way
 * to "<that desktop> is controlling"; Disconnect takes it back and opens the composer.
 */
function RemoteControlledPreview({ label, narrow = false, outcome = 'ok' }: { label: string | null; narrow?: boolean; outcome?: ControlOutcome }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    session.remoteController = { label }
    useChatStore.setState({ activeProject: projectPath, projectSessions: {
      ...previous.projectSessions,
      [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
    } })
    // Main answers with the session's remote_control_changed event.
    mockIpc('app', 'releaseNodeHostSession', () => settle(outcome, () =>
      useChatStore.getState().handleAgentEvent({ type: 'remote_control_changed', released: true, projectPath, sessionId })))
    setReady(true)
    return () => useChatStore.setState(previous)
  }, [label, outcome])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

export const StartedFromAnotherDevice: Story = { render: () => <RemoteControlledPreview label="MacBook Air" /> }
export const StartedFromUnnamedDevice: Story = { render: () => <RemoteControlledPreview label={null} /> }
export const StartedFromLongLabelNarrow: Story = {
  render: () => <RemoteControlledPreview label="Hangqi’s 16-inch MacBook Pro (Office, 3rd floor)" narrow />,
}
export const StartedFromAnotherDeviceDark: Story = { ...StartedFromAnotherDevice, globals: { theme: 'dark' } }
export const StartedFromAnotherDeviceChinese: Story = { ...StartedFromAnotherDevice, globals: { locale: 'zh' } }

/** Disconnect takes the session back: the banner leaves and this computer's composer opens. */
export const DisconnectController: Story = {
  render: () => <RemoteControlledPreview label="MacBook Air" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('chat.remoteController.disconnect') }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: i18n.t('chat.remoteController.disconnect') })).toBeNull())
  },
}
export const DisconnectControllerPending: Story = { render: () => <RemoteControlledPreview label="MacBook Air" outcome="busy" /> }
export const DisconnectControllerError: Story = { render: () => <RemoteControlledPreview label="MacBook Air" outcome="error" /> }

const remoteProjectPath = 'remote:mini:/Users/vensen/super-one'

/** A session on another computer whose user took it back: "<that computer> is controlling", Reconnect drives it again. */
function ReleasedPreview({ narrow = false, outcome = 'ok' }: { narrow?: boolean; outcome?: ControlOutcome }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    session.remoteControlReleased = true
    const environment = window.environment
    useChatStore.setState({ activeProject: remoteProjectPath, projectSessions: {
      ...previous.projectSessions,
      [remoteProjectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
    } })
    window.environment = {
      ...environment,
      listItems: async () => [{ connectionId: 'mini', label: 'VensendeMac-mini' }] as Awaited<ReturnType<typeof window.environment.listItems>>,
      reclaimSessionControl: () => settle(outcome, () => {}),
    }
    setReady(true)
    return () => {
      window.environment = environment
      useChatStore.setState(previous)
    }
  }, [outcome])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

export const TakenBackByHost: Story = { render: () => <ReleasedPreview /> }
export const TakenBackByHostNarrow: Story = { render: () => <ReleasedPreview narrow /> }
export const TakenBackByHostDark: Story = { ...TakenBackByHost, globals: { theme: 'dark' } }
export const TakenBackByHostChinese: Story = { ...TakenBackByHost, globals: { locale: 'zh' } }
export const ReconnectPending: Story = { render: () => <ReleasedPreview outcome="busy" /> }
export const ReconnectError: Story = { render: () => <ReleasedPreview outcome="error" /> }

/** Reconnect takes control again: the banner leaves and the composer opens. */
export const Reconnect: Story = {
  render: () => <ReleasedPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('chat.remoteController.reconnect') }))
    await waitFor(() => expect(canvas.queryByRole('button', { name: i18n.t('chat.remoteController.reconnect') })).toBeNull())
  },
}
