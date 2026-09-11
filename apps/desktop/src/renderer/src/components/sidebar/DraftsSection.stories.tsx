import { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { useDraftsStore } from '@/stores/drafts'
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
const meta = { title: 'Sidebar/DraftsSection', component: DraftsSection, args: { connectionId: 'local' } } satisfies Meta<typeof DraftsSection>
export default meta
type Story = StoryObj<typeof meta>
export const Saved: Story = { render: () => <Preview /> }
export const MobileEditing: Story = { render: () => <Preview remote /> }
export const Empty: Story = { render: () => <Preview empty /> }
export const ClearDraft: Story = { render: () => <Preview editable /> }
export const Cleared: Story = { render: () => <Preview cleared /> }
