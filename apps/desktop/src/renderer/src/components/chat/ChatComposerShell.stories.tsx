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

type Holder = { kind: 'window' | 'phone' | 'controller'; label: string | null }
const controllerLease = { leaseId: 'lease-a', resource: { environmentId: 'env-b', sessionId }, holderClientId: 'client-a', generation: '1', expiresAt: '2099-01-01T00:00:00.000Z' }
const windowLease = { ...controllerLease, leaseId: 'lease-b', holderClientId: 'desktop:env-b', delegate: 'window:1', generation: '2' }

/**
 * One of this computer's sessions a controller desktop drives: its name and
 * Disconnect, which ends its lease and gives the session to this window.
 */
function HeldByControllerPreview({ label, narrow = false, outcome = 'ok' }: { label: string | null; narrow?: boolean; outcome?: ControlOutcome }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const environment = window.environment
    const project = createDefaultProjectState()
    useChatStore.setState({ activeProject: projectPath, projectSessions: {
      ...previous.projectSessions,
      [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: createDefaultPerSessionState() } },
    } })
    // Main's presence: the lease and who holds it.
    const changed = (lease: typeof controllerLease, holder: Holder) =>
      useChatStore.getState().handleAgentEvent({ type: 'session_control_changed', projectPath, sessionId, lease, holder, harnessId: 'claude' })
    changed(controllerLease, { kind: 'controller', label })
    window.environment = { ...environment, disconnectSessionController: () => settle(outcome, () => changed(windowLease, { kind: 'window', label: null })) }
    setReady(true)
    return () => {
      window.environment = environment
      useChatStore.setState(previous)
    }
  }, [label, outcome])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

export const HeldByController: Story = { render: () => <HeldByControllerPreview label="MacBook Air" /> }
export const HeldByUnnamedController: Story = { render: () => <HeldByControllerPreview label={null} /> }
export const HeldByControllerLongLabelNarrow: Story = {
  render: () => <HeldByControllerPreview label="Hangqi’s 16-inch MacBook Pro (Office, 3rd floor)" narrow />,
}
export const HeldByControllerDark: Story = { ...HeldByController, globals: { theme: 'dark' } }
export const HeldByControllerChinese: Story = { ...HeldByController, globals: { locale: 'zh' } }
export const DisconnectHeldControllerPending: Story = { render: () => <HeldByControllerPreview label="MacBook Air" outcome="busy" /> }
export const DisconnectHeldControllerError: Story = { render: () => <HeldByControllerPreview label="MacBook Air" outcome="error" /> }

/** Disconnect: this window takes the session and its composer opens. */
export const DisconnectHeldController: Story = {
  render: () => <HeldByControllerPreview label="MacBook Air" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('chat.remoteController.disconnect') }))
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull())
  },
}

/**
 * A session on another computer that someone there drives: that computer's
 * window yields to Take over; its phone or another controller is shown read-only.
 */
function HeldOnHostPreview({ holder, narrow = false, outcome = 'ok' }: { holder: Holder; narrow?: boolean; outcome?: ControlOutcome }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const project = createDefaultProjectState()
    const environment = window.environment
    useChatStore.setState({ activeProject: remoteProjectPath, projectSessions: {
      ...previous.projectSessions,
      [remoteProjectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: createDefaultPerSessionState() } },
    } })
    // The host's stream says who drives the session there.
    useChatStore.getState().handleAgentEvent({ type: 'session_control_holder', holder, projectPath: remoteProjectPath, sessionId })
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
  }, [holder, outcome])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

const hostWindow: Holder = { kind: 'window', label: null }
export const UsedOnHost: Story = { render: () => <HeldOnHostPreview holder={hostWindow} /> }
export const UsedOnHostNarrow: Story = { render: () => <HeldOnHostPreview holder={hostWindow} narrow /> }
export const UsedOnHostDark: Story = { ...UsedOnHost, globals: { theme: 'dark' } }
export const UsedOnHostChinese: Story = { ...UsedOnHost, globals: { locale: 'zh' } }
export const TakeOverPending: Story = { render: () => <HeldOnHostPreview holder={hostWindow} outcome="busy" /> }
export const TakeOverError: Story = { render: () => <HeldOnHostPreview holder={hostWindow} outcome="error" /> }

/** Take over: the banner leaves and this computer's composer opens. */
export const TakeOver: Story = {
  render: () => <HeldOnHostPreview holder={hostWindow} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: i18n.t('chat.remoteController.takeOver') }))
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull())
  },
}

const hostPhone: Holder = { kind: 'phone', label: 'Vensen’s iPhone' }
const unnamedPhone: Holder = { kind: 'phone', label: null }
const longPhone: Holder = { kind: 'phone', label: 'Vensen’s iPhone 16 Pro Max (personal, the one with the cracked case)' }
const otherController: Holder = { kind: 'controller', label: 'Studio iMac' }
export const HeldByHostPhone: Story = { render: () => <HeldOnHostPreview holder={hostPhone} /> }
export const HeldByUnnamedHostPhone: Story = { render: () => <HeldOnHostPreview holder={unnamedPhone} /> }
export const HeldByHostPhoneLongLabelNarrow: Story = { render: () => <HeldOnHostPreview holder={longPhone} narrow /> }
export const HeldByHostPhoneDark: Story = { ...HeldByHostPhone, globals: { theme: 'dark' } }
export const HeldByHostPhoneChinese: Story = { ...HeldByHostPhone, globals: { locale: 'zh' } }
export const HeldByAnotherController: Story = { render: () => <HeldOnHostPreview holder={otherController} /> }

type Catalog = NonNullable<ReturnType<typeof useAppStore.getState>['harnessCatalog']>
const claudeOn: Catalog = [{ id: 'claude', enabled: true, state: 'ready' }]
const claudeOff: Catalog = [{ id: 'claude', enabled: false, state: 'disabled' }]

/**
 * A Claude session whose harness may be off. The catalog that counts is the
 * session's machine's: this desktop's for its own projects, the node's
 * descriptor (`nodeHarnessIds`) for a node's.
 */
function HarnessGatePreview({ local, nodeHarnessIds, narrow = false }: { local: Catalog; nodeHarnessIds?: string[]; narrow?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const oldCatalog = useAppStore.getState().harnessCatalog
    const environment = window.environment
    const path = nodeHarnessIds ? remoteProjectPath : projectPath
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    session.sessionProvider = 'claude'
    useChatStore.setState({ activeProject: path, projectSessions: {
      ...previous.projectSessions,
      [path]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
    } })
    useAppStore.setState({ harnessCatalog: local })
    // The composer calls more of the environment than this story pins down; the rest stay mocked.
    const listItems = async () => [{ connectionId: 'mini', label: 'VensendeMac-mini', capabilities: { harnessIds: nodeHarnessIds ?? [] } }]
    window.environment = new Proxy(environment, {
      get: (target, key) => key === 'listItems' ? listItems : Reflect.get(target, key),
    })
    setReady(true)
    return () => {
      window.environment = environment
      useChatStore.setState(previous)
      useAppStore.setState({ harnessCatalog: oldCatalog })
    }
  }, [local, nodeHarnessIds])
  return <div style={{ width: narrow ? 320 : 620, maxWidth: '100%' }}>
    {ready && <TooltipProvider><ChatComposerShell showTodoPopup={false} /><Toaster /></TooltipProvider>}
  </div>
}

/** Off on this desktop: read-only, with Re-enable into Settings → Harnesses. */
export const HarnessDisabledHere: Story = {
  render: () => <HarnessGatePreview local={claudeOff} />,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: /Re-enable/ })
  },
}
export const HarnessDisabledHereNarrow: Story = { render: () => <HarnessGatePreview local={claudeOff} narrow /> }
export const HarnessDisabledHereDark: Story = { ...HarnessDisabledHere, globals: { theme: 'dark' } }

/** Off on the node though on here: read-only, and nothing here can turn it on. */
export const HarnessDisabledOnNode: Story = {
  render: () => <HarnessGatePreview local={claudeOn} nodeHarnessIds={['codex']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(/READ ONLY/)
    expect(canvas.queryByRole('button', { name: /Re-enable/ })).toBeNull()
  },
}

/** Off here but running on the node: the node's session stays writable. */
export const HarnessRunsOnNodeOnly: Story = {
  render: () => <HarnessGatePreview local={claudeOff} nodeHarnessIds={['claude']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvasElement.querySelector('.ProseMirror')).not.toBeNull())
    expect(canvas.queryByText(/READ ONLY/)).toBeNull()
  },
}
