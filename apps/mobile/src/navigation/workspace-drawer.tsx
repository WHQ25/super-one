import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Laptop, Power, Search, Settings, SquarePen } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RelayClient } from '@superone/relay-client'
import type { Project } from '../project-types'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { ConnectionStatusIndicator } from '../ui/connection-status'
import { IconButton, SessionListBody, type SessionListActions } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'
import { useProjectSessions } from './use-project-sessions'
import { readPinnedSessions } from './workspace-data'

export type WorkspaceDrawerProps = {
  visible: boolean; onDismiss: () => void; deviceName: string; projects: Project[]
  client: RelayClient | null
  activeProject: Project | null; activeSessionId: string | null; sessions: SessionListRow[]
  onNewSession: (project: Project) => void | Promise<void>
  onOpenSession: (project: Project, session: SessionListRow) => void | Promise<void>
  onPinSession: (project: Project, session: SessionListRow, pinned: boolean) => Promise<boolean>
  onArchiveSession: (project: Project, session: SessionListRow) => Promise<boolean>
  onDeleteSession: (project: Project, session: SessionListRow) => Promise<boolean>
  deviceStatus: DeviceStatus
  reconnect?: ReconnectInfo | null
  /** Drop the transport and return to the device list — the only way to another
   *  desktop, so the row itself is a readout, not a link. */
  onDisconnect: () => void
  onAddProject: () => void
  onSearch: () => void
  onOpenAppSettings: () => void
}

/**
 * The phone's equivalent of the desktop sidebar: every project and every session
 * lives here, and nowhere else. Chat sits directly on the device list, so this is
 * also how the user leaves a session without ending it.
 *
 * It deliberately does NOT take the desktop's `--sidebar-*` palette, which in
 * light mode is a dark inverted chrome: at phone width that reads as a second app
 * rather than a panel of this one. Only the transcript carries harness colour.
 */
export function WorkspaceDrawer(props: WorkspaceDrawerProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // `undefined` follows the active project; `null` is an explicit collapse, so
  // collapsing the active one cannot snap straight back open.
  const [expanded, setExpanded] = useState<Project | null | undefined>(undefined)
  const [pinned, setPinned] = useState<SessionListRow[]>([])
  useEffect(() => { if (props.visible) setExpanded(undefined) }, [props.visible])

  const { client } = props
  const refreshPinned = useCallback(() => {
    if (!client) return
    readPinnedSessions(client).then(setPinned).catch(() => { /* the section just stays as it was */ })
  }, [client])
  useEffect(() => { if (props.visible) refreshPinned() }, [props.visible, refreshPinned])

  const open = props.visible ? (expanded === undefined ? props.activeProject : expanded) : null
  // One project is expanded at a time, so one list state serves the whole drawer.
  const sessions = useProjectSessions(
    client,
    open,
    open?.path === props.activeProject?.path ? props.sessions : [],
    props.activeSessionId,
  )
  const leave = (run: () => void) => { props.onDismiss(); run() }
  const projectFor = (session: SessionListRow): Project | null =>
    session.projectPath
      ? props.projects.find((item) => item.path === session.projectPath)
        ?? { path: session.projectPath, name: session.projectName ?? session.projectPath }
      : open
  const actions: SessionListActions = {
    onOpenSession: (session) => { if (open) leave(() => void props.onOpenSession(open, session)) },
    onPinSession: (session, next) => {
      const target = projectFor(session)
      if (!target) return Promise.resolve(false)
      return props.onPinSession(target, session, next).then((ok) => { if (ok) refreshPinned(); return ok })
    },
    onArchiveSession: (session) => {
      const target = projectFor(session)
      return target ? props.onArchiveSession(target, session).then((ok) => { if (ok) refreshPinned(); return ok }) : Promise.resolve(false)
    },
    onDeleteSession: (session) => {
      const target = projectFor(session)
      return target ? props.onDeleteSession(target, session).then((ok) => { if (ok) refreshPinned(); return ok }) : Promise.resolve(false)
    },
  }

  return <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onDismiss} supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <View style={{ flex: 1, backgroundColor: colors.scrim, flexDirection: 'row' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close workspace" onPress={props.onDismiss} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <View accessibilityViewIsModal style={{ width: Math.min(width - 40, 360), backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom, borderRightWidth: 1, borderRightColor: colors.border }}>
        {/* Search is global and lives on its own screen, so this is a button that
            looks like a field, not a field. New session sits beside it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Search all sessions"
            onPress={() => leave(props.onSearch)}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40,
              paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 })}>
            <Search size={15} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Search sessions</Text>
          </Pressable>
          {props.activeProject ? <IconButton icon={SquarePen} label="New session"
            onPress={() => leave(() => void props.onNewSession(props.activeProject!))} chrome="plain" color={colors.foreground} /> : null}
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
          {pinned.length ? <View style={{ paddingBottom: 8 }}>
            <Text style={{ paddingHorizontal: 12, paddingBottom: 4, color: colors.mutedForeground, fontSize: 12 }}>Pinned</Text>
            {pinned.map((session) => <Pressable key={session.sessionId} accessibilityRole="button"
              onPress={() => { const target = projectFor(session); if (target) leave(() => void props.onOpenSession(target, session)) }}
              style={({ pressed }) => ({ borderRadius: radius.md, opacity: pressed ? 0.7 : 1 })}>
              <SessionRowContent
                item={{ session, child: false, hasChildren: false, collapsed: false }}
                selected={session.sessionId === props.activeSessionId}
                surface="panel"
                subtitle={session.projectName}
              />
            </Pressable>)}
          </View> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 2, paddingBottom: 4 }}>
            <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>Projects</Text>
            <IconButton icon={FolderPlus} label="Add project" onPress={() => leave(props.onAddProject)} chrome="plain" color={colors.mutedForeground} />
          </View>
          {!props.projects.length ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>No projects yet. Add one to start a session.</Text> : null}
          {props.projects.map((project) => {
            const isOpen = project.path === open?.path
            return <View key={project.path}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                onPress={() => setExpanded(isOpen ? null : project)}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
                <Folder size={16} color={colors.mutedForeground} />
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, flex: 1 }}>{project.name}</Text>
                {isOpen ? <ChevronDown size={14} color={colors.mutedForeground} /> : <ChevronRight size={14} color={colors.mutedForeground} />}
              </Pressable>
              {isOpen ? <View style={{ paddingLeft: 8 }}>
                <SessionListBody {...actions} sessions={sessions} surface="panel" activeSessionId={props.activeSessionId} />
              </View> : null}
            </View>
          })}
        </ScrollView>

        {/* The device sits at the bottom, the way the desktop keeps the account
            it is signed into there: it names the connection rather than starting
            the task, so it must not be the first thing in the panel. Reaching
            another desktop means disconnecting from this one, so the row reports
            the link instead of offering to switch it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 6,
          minHeight: 60, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Laptop size={20} color={colors.mutedForeground} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{props.deviceName}</Text>
            <ConnectionStatusIndicator status={props.deviceStatus} reconnect={props.reconnect} iconSize={12} fontSize={11} />
          </View>
          {/* One cluster: both act on the shell, not on the device named beside them. */}
          <View style={{ flexDirection: 'row', marginRight: -8 }}>
            <IconButton icon={Power} label="Disconnect" onPress={() => leave(props.onDisconnect)} />
            <IconButton icon={Settings} label="Settings" onPress={() => leave(props.onOpenAppSettings)} />
          </View>
        </View>
      </View>
    </View>
  </Modal>
}
