import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { MobileThemeProvider } from '../theme/context'
import { Text } from '../ui/text'
import { WorkspaceDrafts } from './workspace-drafts'
import { WorkspaceList } from './workspace-list'
import { WorkspaceListCache } from '../workspace-list-cache'

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
    activeProject={null} activeSessionId={null} sessions={[]} cache={new WorkspaceListCache()} visible listRevision={0}
    onNewSession={() => {}} onOpenSession={() => {}} onPinSession={async () => true}
    onSettleSession={async () => true} onDeleteSession={async () => true} onSearch={() => {}} onAddProject={() => {}}
    drafts={remote ? rows.map((row) => ({ ...row, controllerDeviceId: 'phone' })) : rows} activeDraftId={activeId}
    onOpenDraft={(row) => setActiveId(row.id)}
    onDeleteDraft={(row) => setRows((current) => current.filter((item) => item.id !== row.id))} /></View>
}
export default { title: 'Mobile/WorkspaceDrafts', component: WorkspaceDrafts }
export const Interactive = { render: () => <MobileThemeProvider><View style={{ width: 280 }}><DraftsPreview /></View></MobileThemeProvider> }
export const Empty = { render: () => <MobileThemeProvider><DraftsPreview empty /></MobileThemeProvider> }
export const Cleared = { render: () => <MobileThemeProvider><View style={{ width: 280 }}><DraftsPreview cleared /></View></MobileThemeProvider> }
export const RemoteEditing = { render: () => <MobileThemeProvider><DraftsPreview remote /></MobileThemeProvider> }

/** The open composer is not a row. The other parked draft stays. */
export const EditingCurrent = {
  render: () => <MobileThemeProvider><View style={{ width: 280 }}>
    <WorkspaceDrafts drafts={draftPreviewRows} activeDraftId="draft-1" onOpenDraft={() => {}} onDeleteDraft={() => {}} />
  </View></MobileThemeProvider>,
  name: 'Editing · current draft stays out of the list',
}

export const Folded = {
  render: () => <MobileThemeProvider><View style={{ width: 280 }}>
    <WorkspaceDrafts drafts={draftPreviewRows} collapsed onOpenDraft={() => {}} onDeleteDraft={() => {}} />
  </View></MobileThemeProvider>,
  name: 'Folded · count, notebook icon',
}

export const Narrow = {
  render: () => <MobileThemeProvider><View style={{ width: 220 }}>
    <WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={() => {}} onDeleteDraft={() => {}} />
  </View></MobileThemeProvider>,
  name: 'Narrow',
}

export const Light = {
  render: () => <MobileThemeProvider colorScheme="light"><View style={{ width: 280, backgroundColor: '#fff' }}>
    <WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={() => {}} onDeleteDraft={() => {}} />
  </View></MobileThemeProvider>,
  name: 'Light',
}

export const Chinese = {
  render: () => <MobileThemeProvider locale="zh"><View style={{ width: 280 }}>
    <WorkspaceDrafts drafts={draftPreviewRows} collapsed onOpenDraft={() => {}} onDeleteDraft={() => {}} />
  </View></MobileThemeProvider>,
  name: '中文 · 折叠',
}

/** A draft that appears after the sidebar is already up flies in from the right. */
export const Arriving = {
  render: () => <MobileThemeProvider><View style={{ width: 280 }}>
    <ArrivingPreview />
  </View></MobileThemeProvider>,
  name: 'Arriving · flies in from the right',
}

function ArrivingPreview() {
  const [rows, setRows] = useState(draftPreviewRows.slice(0, 1))
  return <>
    <Pressable accessibilityRole="button" onPress={() => setRows(draftPreviewRows)} style={{ padding: 12 }}>
      <Text>Add draft</Text>
    </Pressable>
    <WorkspaceDrafts drafts={rows} onOpenDraft={() => {}} onDeleteDraft={(row) => setRows((current) => current.filter((item) => item.id !== row.id))} />
  </>
}
