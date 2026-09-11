import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import type { SessionListRow } from '../session-list-state'
import type { MobileSessionActivity } from '../session-activity-state'
import { SessionActivityContext } from './use-session-activity'
import { WorkspaceProjectRow, type WorkspaceProjectRowProps } from './workspace-project-row'

const noop = () => {}
const confirmed = () => Promise.resolve(true)

const sessions: SessionListRow[] = [
  { sessionId: 's1', title: 'Fix the drawer', provider: 'codex' },
  { sessionId: 's2', title: 'Landscape sidebar height', provider: 'claude' },
  { sessionId: 's3', title: 'Collab task bubble', provider: 'codex' },
  { sessionId: 's4', title: 'Terminal tab strip', provider: 'claude' },
  { sessionId: 's5', title: 'File preview cache', provider: 'codex' },
  { sessionId: 's6', title: 'Show more', provider: 'claude' },
]

const base: WorkspaceProjectRowProps = {
  client: null,
  project: { path: '/repo', name: 'super-one' },
  expanded: false,
  onToggle: noop,
  seed: sessions,
  activeSessionId: 's2',
  visible: true,
  listRevision: 0,
  onOpenSession: noop,
  onPinSession: confirmed,
  onArchiveSession: confirmed,
  onDeleteSession: confirmed,
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 300, paddingVertical: 12, backgroundColor: '#111' }}>{children}</View>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/WorkspaceProjectRow',
  component: WorkspaceProjectRow,
}

export const Collapsed = {
  render: () => <Frame><WorkspaceProjectRow {...base} /></Frame>,
  name: 'Collapsed',
}

export const Expanded = {
  render: () => <Frame><WorkspaceProjectRow {...base} expanded /></Frame>,
  name: 'Expanded',
}

export const UnfoldToggle = {
  render: function Interactive() {
    const [expanded, setExpanded] = useState(false)
    return (
      <Frame>
        <WorkspaceProjectRow {...base} expanded={expanded} onToggle={() => setExpanded((open) => !open)} />
        <WorkspaceProjectRow
          {...base}
          project={{ path: '/mobile', name: 'mobile' }}
          seed={[{ sessionId: 'm1', title: 'Pairing flow', provider: 'codex' }]}
          activeSessionId={null}
          expanded={false}
        />
      </Frame>
    )
  },
  name: 'Unfold · tap the project',
}

const pending: Record<string, MobileSessionActivity> = {
  ask: {
    sessionId: 'ask',
    projectPath: '/repo',
    status: 'idle',
    provider: 'codex',
    title: 'Needs input',
    pendingCount: 1,
    pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' },
  },
}

export const CollapsedWithLiveWork = {
  render: () => (
    <MobileThemeProvider>
      <SessionActivityContext.Provider value={pending}>
        <View style={{ width: 300, paddingVertical: 12, backgroundColor: '#111' }}>
          <WorkspaceProjectRow
            {...base}
            seed={[{ sessionId: 'idle', title: 'Idle session' }, { sessionId: 'ask', title: 'Needs input' }]}
            activeSessionId={null}
          />
        </View>
      </SessionActivityContext.Provider>
    </MobileThemeProvider>
  ),
  name: 'Collapsed · pending session still visible',
}
