import { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { useDraftsStore } from '@/stores/drafts'
import { useChatStore } from '@/stores/chat-store'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { startDraftAutosave } from '@/lib/draft-sync'
import { DraftsSection } from './DraftsSection'

const rows: DraftListEntry[] = [{ id: 'preview-draft', text: 'Continue the mobile draft migration', title: 'Continue the mobile draft migration',
  docJson: null, attachments: [], projectPath: '/preview', harness: 'codex', model: 'gpt-5.4', permissionMode: 'default', settings: {},
  originSessionId: null, createdAt: '', updatedAt: '' }]

function Preview({ remote = false, empty = false, editable = false, cleared = false }: { remote?: boolean; empty?: boolean; editable?: boolean; cleared?: boolean }) {
  const [text, setText] = useState(cleared ? '' : rows[0].text)
  useLayoutEffect(() => {
    const previous = useDraftsStore.getState()
    const environment = window.environment
    const drafts = empty ? [] : rows.map((row) => ({ ...row, text, title: text.trim(), controllerDeviceId: remote ? 'phone' : null }))
    window.environment = { ...environment, listDrafts: async () => drafts, deleteDraft: async () => {} }
    useDraftsStore.setState({ byConnection: { local: drafts }, discardedIds: {} })
    return () => {
      window.environment = environment
      useDraftsStore.setState(previous)
    }
  }, [remote, empty, text])
  return <div className="w-72 bg-sidebar p-2">
    {editable && <input aria-label="Draft content" className="mb-3 w-full rounded border p-2" value={text} onChange={(event) => setText(event.target.value)} />}
    <DraftsSection connectionId="local" />
  </div>
}

function SideChatDraftPreview() {
  const projectPath = '/side-chat-draft-preview'
  const sessions = useChatStore((state) => state.projectSessions[projectPath]?._sessions)
  useLayoutEffect(() => {
    const previousChat = useChatStore.getState()
    const previousDrafts = useDraftsStore.getState()
    const environment = window.environment
    const app = window.app
    window.app = { ...app, trace: () => {} }
    window.environment = { ...environment,
      listDrafts: async () => useDraftsStore.getState().byConnection.local ?? [],
      upsertDraft: async (_connectionId, input) => ({ ...rows[0], ...input, settings: input.settings ?? {}, title: input.text.trim(), controllerDeviceId: null }),
      deleteDraft: async () => {},
    }
    useDraftsStore.setState({ byConnection: { local: [] }, discardedIds: {} })
    useChatStore.setState({ activeProject: projectPath, projectSessions: { [projectPath]: {
      ...createDefaultProjectState(), _activeSessionId: 'preview-parent', _sessions: {
        'preview-parent': { ...createDefaultPerSessionState(), messages: [{ id: 'preview-message', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Parent conversation' }], createdAt: new Date().toISOString(), providerId: 'claude' }] },
        'preview-side': { ...createDefaultPerSessionState(), _sideChatParentId: 'preview-parent' },
        'preview-ordinary': createDefaultPerSessionState(),
      },
    } } })
    const stop = startDraftAutosave()
    return () => {
      stop()
      window.environment = environment
      window.app = app
      useChatStore.setState(previousChat)
      useDraftsStore.setState(previousDrafts)
    }
  }, [])
  return <div className="w-72 space-y-3 bg-sidebar p-2">
    <p className="text-xs text-muted-foreground">Side-chat edits stay here. Ordinary unsent edits appear in Drafts after autosave.</p>
    {(['preview-side', 'preview-ordinary'] as const).map((sessionId) => <label key={sessionId} className="block text-sm">
      {sessionId === 'preview-side' ? 'Side chat' : 'Ordinary unsent session'}
      <input aria-label={sessionId === 'preview-side' ? 'Side chat input' : 'Ordinary session input'} className="mt-1 w-full rounded border p-2" value={sessions?.[sessionId]?.draftText ?? ''}
        onChange={(event) => useChatStore.getState().setDraftText(event.target.value, { projectPath, sessionId })} />
    </label>)}
    <DraftsSection connectionId="local" />
  </div>
}
const meta = { title: 'Sidebar/DraftsSection', component: DraftsSection, args: { connectionId: 'local' } } satisfies Meta<typeof DraftsSection>
export default meta
type Story = StoryObj<typeof meta>
export const Saved: Story = { render: () => <Preview /> }
export const MobileEditing: Story = { render: () => <Preview remote /> }
export const Empty: Story = { render: () => <Preview empty /> }
export const ClearDraft: Story = { render: () => <Preview editable /> }
export const Cleared: Story = { render: () => <Preview cleared /> }
export const TemporarySideChat: Story = { render: () => <SideChatDraftPreview /> }
