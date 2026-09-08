import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Modal, PanResponder, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { FolderPlus, Search, SquarePen } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RelayClient } from '@superone/relay-client'
import type { Project } from '../project-types'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { IconButton, SwipeSessionRow } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'
import { SwipeRevealProvider, useSwipeRevealScope } from '../ui/swipe-reveal-scope'
import { WorkspaceProjectRow } from './workspace-project-row'
import { readPinnedSessions } from './workspace-data'
import { SidebarDeviceFooter } from './sidebar-device-footer'
import { useMobileLocale } from '../i18n/context'

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
  /**
   * Bumped by the shell when the host reports a session-list change (and once
   * after a reconnect). The lists are re-read on a bump, not on every open —
   * opening a drawer nothing has changed under costs no request at all.
   */
  listRevision: number
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
  const { t } = useMobileLocale()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // Several projects may stand open at once, as on the desktop. Opening the
  // drawer adds the project the user is in without disturbing the rest, so
  // landing on your own work never costs someone else's expansion.
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [pinned, setPinned] = useState<SessionListRow[]>([])
  const activePath = props.activeProject?.path
  useEffect(() => {
    if (!props.visible || !activePath) return
    setExpandedPaths((current) => current.has(activePath) ? current : new Set([...current, activePath]))
  }, [props.visible, activePath])

  const panelWidth = Math.min(width - 40, 360)
  // The panel's own offset, so the same drag that pulled it out can push it
  // back. The Modal's fade covers the frame before the spring starts.
  const slide = useRef(new Animated.Value(0)).current
  const { onDismiss } = props
  const settleOpen = useCallback(
    () => { Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start() },
    [slide],
  )
  useEffect(() => {
    // Parked off-screen whenever hidden, so a drag that was released halfway
    // cannot leave the panel mid-slide the next time it opens.
    slide.setValue(-panelWidth)
    if (props.visible) settleOpen()
  }, [props.visible, panelWidth, settleOpen, slide])
  const reveal = useSwipeRevealScope()
  const drag = useMemo(() => PanResponder.create({
    // Leftward only: a rightward drag belongs to a session row's swipe actions,
    // and a closed row declines the leftward one so it reaches this responder.
    onMoveShouldSetPanResponder: (_, gesture) => {
      // A row with its actions showing owns that drag outright. There the
      // gesture means "put this row back", and closing the whole drawer instead
      // would throw away the panel the user was working in.
      if (reveal.anyRevealed()) return false
      return gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5
    },
    onPanResponderMove: (_, gesture) => { slide.setValue(Math.min(0, gesture.dx)) },
    onPanResponderRelease: (_, gesture) => {
      // A flick counts even when it is short: the distance test alone would
      // spring a fast, decisive gesture back open.
      if (gesture.dx < -56 || gesture.vx < -0.5) {
        Animated.timing(slide, { toValue: -panelWidth, duration: 160, useNativeDriver: true }).start(onDismiss)
        return
      }
      settleOpen()
    },
    onPanResponderTerminate: settleOpen,
  }), [onDismiss, panelWidth, reveal, settleOpen, slide])

  const { client } = props
  const refreshPinned = useCallback(() => {
    if (!client) return
    readPinnedSessions(client).then(setPinned).catch(() => { /* the section just stays as it was */ })
  }, [client])

  // The project lists live in the rows; this covers only the cross-project
  // Pinned section, which has no other loader. `-1` so the first open loads it.
  const syncedRevision = useRef(-1)
  useEffect(() => {
    if (!props.visible || syncedRevision.current === props.listRevision) return
    syncedRevision.current = props.listRevision
    refreshPinned()
  }, [props.visible, props.listRevision, refreshPinned])
  const leave = (run: () => void) => { props.onDismiss(); run() }
  /**
   * The project a pinned row lives in. `list_pinned_sessions` is cross-project
   * and always names one, so a row without it has nothing to act on — rather
   * than inventing a project for it, the row is dropped.
   */
  const pinnedProject = (session: SessionListRow): Project | null =>
    session.projectPath
      ? props.projects.find((item) => item.path === session.projectPath)
        ?? { path: session.projectPath, name: session.projectName ?? session.projectPath }
      : null
  /** Pin, hide and delete also move rows in the Pinned section above. */
  const listActionsFor = (project: Project) => ({
    onOpenSession: (session: SessionListRow) => leave(() => void props.onOpenSession(project, session)),
    onPinSession: (session: SessionListRow, next: boolean) =>
      props.onPinSession(project, session, next).then((ok) => { if (ok) refreshPinned(); return ok }),
    onArchiveSession: (session: SessionListRow) =>
      props.onArchiveSession(project, session).then((ok) => { if (ok) refreshPinned(); return ok }),
    onDeleteSession: (session: SessionListRow) =>
      props.onDeleteSession(project, session).then((ok) => { if (ok) refreshPinned(); return ok }),
  })

  return <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onDismiss} supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <View style={{ flex: 1, backgroundColor: colors.scrim, flexDirection: 'row' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Close workspace')} onPress={props.onDismiss} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <Animated.View accessibilityViewIsModal {...drag.panHandlers}
        style={{ width: panelWidth, backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom,
          borderRightWidth: 1, borderRightColor: colors.border, transform: [{ translateX: slide }] }}>
        <SwipeRevealProvider scope={reveal}>
        {/* Search is global and lives on its own screen, so this is a button that
            looks like a field, not a field. New session sits beside it. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Search all sessions')}
            onPress={() => leave(props.onSearch)}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40,
              paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 })}>
            <Search size={15} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{t('Search sessions')}</Text>
          </Pressable>
          {props.activeProject ? <IconButton icon={SquarePen} label="New session"
            onPress={() => leave(() => void props.onNewSession(props.activeProject!))} chrome="plain" color={colors.foreground} /> : null}
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
          {pinned.length ? <View style={{ paddingBottom: 6 }}>
            <Text style={{ paddingHorizontal: 12, paddingBottom: 2, color: colors.mutedForeground, fontSize: 12 }}>{t('Pinned')}</Text>
            {/* The same swipe the project lists carry, so unpinning happens where
                the pin is visible instead of only where the session lives. */}
            {pinned.map((session) => {
              const project = pinnedProject(session)
              if (!project) return null
              const actions = listActionsFor(project)
              return <SwipeSessionRow
                key={session.sessionId}
                title={session.title}
                pinned={session.isPinned ?? true}
                onPress={() => actions.onOpenSession(session)}
                onPin={() => { void actions.onPinSession(session, false) }}
                onArchive={() => { void actions.onArchiveSession(session) }}
                onDelete={() => { void actions.onDeleteSession(session) }}
              >
                {({ revealed }) => <SessionRowContent
                  item={{ session, child: false, hasChildren: false, collapsed: false }}
                  selected={session.sessionId === props.activeSessionId}
                  surface="panel"
                  revealed={revealed}
                  subtitle={session.projectName}
                />}
              </SwipeSessionRow>
            })}
          </View> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 2, paddingBottom: 2 }}>
            <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 12 }}>{t('Projects')}</Text>
            <IconButton icon={FolderPlus} label="Add project" onPress={() => leave(props.onAddProject)} chrome="plain" color={colors.mutedForeground} />
          </View>
          {!props.projects.length ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>{t('No projects yet. Add one to start a session.')}</Text> : null}
          {props.projects.map((project) => <WorkspaceProjectRow
            key={project.path}
            client={client}
            project={project}
            expanded={expandedPaths.has(project.path)}
            onToggle={() => setExpandedPaths((current) => {
              const next = new Set(current)
              if (!next.delete(project.path)) next.add(project.path)
              return next
            })}
            seed={project.path === activePath ? props.sessions : undefined}
            activeSessionId={props.activeSessionId}
            visible={props.visible}
            listRevision={props.listRevision}
            {...listActionsFor(project)}
          />)}
        </ScrollView>

        {/* The device sits at the bottom, the way the desktop keeps the account
            it is signed into there: it names the connection rather than starting
            the task, so it must not be the first thing in the panel. Reaching
            another desktop means disconnecting from this one, so the row reports
            the link instead of offering to switch it. */}
        <SidebarDeviceFooter
          deviceName={props.deviceName}
          deviceStatus={props.deviceStatus}
          reconnect={props.reconnect}
          onDisconnect={() => leave(props.onDisconnect)}
          onOpenSettings={() => leave(props.onOpenAppSettings)}
        />
        </SwipeRevealProvider>
      </Animated.View>
    </View>
  </Modal>
}
