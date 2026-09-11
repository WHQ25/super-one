import { useState } from 'react'
import { View } from 'react-native'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { MobileThemeProvider } from '../theme/context'
import { WorkspaceDrafts } from './workspace-drafts'
import { WorkspaceList } from './workspace-list'

export const draftPreviewRows: DraftListEntry[] = [
  { id: 'draft-1', title: 'Continue the mobile composer migration', text: 'Continue the mobile composer migration', docJson: null,
    projectPath: '/workspace/super-one', attachments: [], harness: 'codex', model: 'gpt-5.4', permissionMode: 'default', settings: {},
    originSessionId: null, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' },
  { id: 'draft-2', title: 'A very long draft title that should truncate on a narrow phone and leave its controls visible', text: 'A very long draft title that should truncate on a narrow phone and leave its controls visible', docJson: null,
    projectPath: '/workspace/project', attachments: [], harness: 'claude', model: 'claude-opus-4-6', permissionMode: 'default', settings: {},
    originSessionId: null, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', pendingSync: true },
]
export function DraftsPreview({ empty = false, remote = false, cleared = false }: { empty?: boolean; remote?: boolean; cleared?: boolean }) {
  const [rows, setRows] = useState(empty ? [] : cleared ? draftPreviewRows.map((row) => ({ ...row, text: '', title: '' })) : draftPreviewRows)
  const [activeId, setActiveId] = useState<string | null>(null)
  return <View style={{ height: 450 }}><WorkspaceList client={null}
    projects={[{ path: '/workspace/super-one', name: 'SuperOne' }, { path: '/workspace/project', name: 'Project' }]}
    activeProject={null} activeSessionId={null} sessions={[]} visible listRevision={0}
    onNewSession={() => {}} onOpenSession={() => {}} onPinSession={async () => true}
    onArchiveSession={async () => true} onDeleteSession={async () => true} onSearch={() => {}} onAddProject={() => {}}
    drafts={remote ? rows.map((row) => ({ ...row, controllerDeviceId: 'phone' })) : rows} activeDraftId={activeId}
    onOpenDraft={(row) => setActiveId(row.id)}
    onDeleteDraft={(row) => setRows((current) => current.filter((item) => item.id !== row.id))} /></View>
}
export default { title: 'Mobile/WorkspaceDrafts', component: WorkspaceDrafts }
export const Interactive = { render: () => <MobileThemeProvider><View style={{ width: 280 }}><DraftsPreview /></View></MobileThemeProvider> }
export const Empty = { render: () => <MobileThemeProvider><DraftsPreview empty /></MobileThemeProvider> }
export const Cleared = { render: () => <MobileThemeProvider><View style={{ width: 280 }}><DraftsPreview cleared /></View></MobileThemeProvider> }
export const RemoteEditing = { render: () => <MobileThemeProvider><DraftsPreview remote /></MobileThemeProvider> }
