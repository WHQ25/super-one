import type { ReactNode } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { Text } from '../ui/text'
import type { SessionListRow } from '../session-list-state'
import { countAttentionSessions, type MobileSessionActivity } from '../session-activity-state'
import { MobileHeader } from './mobile-header'
import { SessionActivityContext } from './use-session-activity'
import { WorkspaceSidebar, type WorkspaceSidebarProps } from './workspace-sidebar'

const noop = () => {}
const confirmed = () => Promise.resolve(true)

const sessions: SessionListRow[] = [
  { sessionId: 's1', title: 'Fix the drawer', provider: 'codex' },
  { sessionId: 's2', title: 'Landscape sidebar should fill the window height', provider: 'claude' },
]

const base: WorkspaceSidebarProps = {
  client: null,
  projects: [{ path: '/repo', name: 'repo' }, { path: '/other', name: 'other' }],
  activeProject: { path: '/repo', name: 'repo' },
  activeSessionId: 's1',
  sessions,
  listRevision: 0,
  onNewSession: noop,
  onOpenSession: noop,
  onPinSession: confirmed,
  onArchiveSession: confirmed,
  onDeleteSession: confirmed,
  onSearch: noop,
  onAddProject: noop,
  deviceName: 'Studio',
  deviceStatus: 'connectedLan',
  onDisconnect: noop,
  onOpenSettings: noop,
}

function Frame({ children, width = 280, height = 640 }: { children: ReactNode; width?: number; height?: number }) {
  return (
    <MobileThemeProvider>
      <View style={{ width, height, backgroundColor: '#111' }}>{children}</View>
    </MobileThemeProvider>
  )
}

function Preview(props: WorkspaceSidebarProps) {
  return <Frame><WorkspaceSidebar {...props} /></Frame>
}

export default {
  title: 'Mobile/WorkspaceSidebar',
  component: WorkspaceSidebar,
  render: Preview,
  args: base,
}

export const Default = {}

export const Reconnecting = {
  args: {
    deviceStatus: 'connecting' as const,
    reconnect: { attempting: true, waiting: false, delayMs: 2_000, nextAtMs: null },
  },
  name: 'Reconnecting · status under the device at the bottom',
}

export const Offline = {
  args: { deviceStatus: 'offline' as const },
  name: 'Offline · status under the device at the bottom',
}

export const Empty = {
  args: { projects: [], activeProject: { path: '/repo', name: 'repo' }, sessions: [] },
  name: 'Empty · no projects',
}

export const NoActiveProject = {
  args: { activeProject: null, sessions: [] },
  name: 'No active project',
}

export const LongTitles = {
  args: {
    sessions: [
      {
        sessionId: 'long',
        title: 'Investigate why the landscape sidebar sits under the session title instead of filling the window height',
        provider: 'claude' as const,
      },
      ...sessions,
    ],
  },
}

export const Narrow = {
  render: (props: WorkspaceSidebarProps) => (
    <Frame width={240}><WorkspaceSidebar {...props} /></Frame>
  ),
}

const pending: Record<string, MobileSessionActivity> = {
  s2: {
    sessionId: 's2',
    projectPath: '/repo',
    status: 'idle',
    provider: 'claude',
    title: 'Landscape sidebar should fill the window height',
    pendingCount: 2,
    pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' },
  },
  ask: {
    sessionId: 'ask',
    projectPath: '/other',
    status: 'idle',
    provider: 'codex',
    title: 'Needs input',
    pendingCount: 1,
    pendingReason: { en: 'Review plan', zh: '审查计划' },
  },
  run: {
    sessionId: 'run',
    projectPath: '/other',
    status: 'streaming',
    provider: 'claude',
    title: 'Long running task',
    pendingCount: 0,
    pendingReason: { en: null, zh: null },
  },
  unread: {
    sessionId: 'unread',
    projectPath: '/other',
    status: 'idle',
    provider: 'codex',
    title: 'Unseen completed session',
    pendingCount: 0,
    isUnseen: true,
    pendingReason: { en: null, zh: null },
  },
}

export const NeedsAttention = {
  render: (props: WorkspaceSidebarProps) => (
    <MobileThemeProvider>
      <SessionActivityContext.Provider value={pending}>
        <View style={{ width: 280, height: 640, backgroundColor: '#111' }}>
          <WorkspaceSidebar {...props} />
        </View>
      </SessionActivityContext.Provider>
    </MobileThemeProvider>
  ),
  name: 'Attention · pending, running and unseen, including a collapsed project',
}

export const PhoneMenuBadge = {
  render: () => (
    <MobileThemeProvider>
      <View style={{ width: 390, backgroundColor: '#111' }}>
        <MobileHeader
          route="chat"
          title="Fix the drawer"
          subtitle="repo"
          provider="codex"
          hasSession
          sessionId="s1"
          pendingCount={countAttentionSessions(pending)}
          deviceStatus="connectedLan"
          onBack={noop}
          onSwitchSession={noop}
          onOpenTerminal={noop}
          onOpenFiles={noop}
        />
      </View>
    </MobileThemeProvider>
  ),
  name: 'Phone · attention dot on the menu',
}

function LandscapeFrame(props: WorkspaceSidebarProps) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 844, height: 390, flexDirection: 'row' }}>
        <WorkspaceSidebar {...props} />
        <View style={{ flex: 1 }}>
          <MobileHeader
            route="chat"
            title="Fix the drawer"
            subtitle="repo"
            provider="codex"
            hasSession
            sessionId="s1"
            deviceStatus={props.deviceStatus}
            reconnect={props.reconnect}
            sidebarVisible
            onBack={noop}
            onSwitchSession={noop}
            onOpenTerminal={noop}
            onOpenFiles={noop}
          />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text>Chat</Text>
          </View>
        </View>
      </View>
    </MobileThemeProvider>
  )
}

/** Header is a sibling of the pane, not a parent — the list fills the window height. */
export const LandscapeSplit = {
  render: LandscapeFrame,
  name: 'Landscape · sidebar full height',
}

export const LandscapeReconnecting = {
  render: LandscapeFrame,
  args: {
    deviceStatus: 'connecting' as const,
    reconnect: { attempting: true, waiting: false, delayMs: 2_000, nextAtMs: null },
  },
  name: 'Landscape · reconnecting under the device only',
}
