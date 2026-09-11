import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type PerSessionState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ChatComposerShell } from './ChatComposerShell'
import { plainTextToTiptapDoc } from './chat-input/plainTextToTiptapDoc'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { Toaster } from 'sonner'

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

function DraftPreview({ narrow = false, busy = false, failure = false }: { narrow?: boolean; busy?: boolean; failure?: boolean }) {
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
      Object.assign(session, { draftId: 'shared-draft', draftText: text, draftJson: plainTextToTiptapDoc(text), draftRemoteDeviceId: 'phone' })
      useChatStore.setState({ activeProject: projectPath, projectSessions: {
        ...useChatStore.getState().projectSessions,
        [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } },
      } })
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
  }, [busy, failure])
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
