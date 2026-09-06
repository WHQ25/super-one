import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { ChevronDown, ChevronRight, Folder, Laptop, Plus, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Project } from '../screens/projects-screen'
import { useMobileTheme } from '../theme/context'
import { Button, IconButton } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'
import type { TabletSessionRow } from './tablet-session-sidebar'

export type WorkspaceDrawerProps = {
  visible: boolean; onDismiss: () => void; deviceName: string; projects: Project[]
  activeProject: Project | null; activeSessionId: string | null; sessions: TabletSessionRow[]
  loadSessions: (project: Project) => Promise<TabletSessionRow[]>
  onNewSession: (project: Project) => void | Promise<void>
  onOpenSession: (project: Project, session: TabletSessionRow) => void | Promise<void>
}

export function WorkspaceDrawer(props: WorkspaceDrawerProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rows, setRows] = useState<TabletSessionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const select = async (project: Project) => {
    const request = ++generation.current
    setExpanded(project.path)
    setRows(project.path === props.activeProject?.path ? props.sessions : [])
    setBusy(true)
    setError('')
    try {
      const result = await props.loadSessions(project)
      if (request === generation.current) setRows(result)
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load sessions')
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  useEffect(() => {
    if (props.visible && props.activeProject) void select(props.activeProject)
    return () => { generation.current++ }
  }, [props.visible, props.activeProject?.path])
  return <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onDismiss} supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <View style={{ flex: 1, backgroundColor: colors.scrim, flexDirection: 'row' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close workspace" onPress={props.onDismiss} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      <View accessibilityViewIsModal style={{ width: Math.min(width - 40, 360), backgroundColor: colors.surface, paddingTop: insets.top, paddingBottom: insets.bottom, borderRightWidth: 1, borderRightColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 6, minHeight: 72 }}>
          <Laptop size={22} color={colors.mutedForeground} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>{props.deviceName}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>Workspace</Text>
          </View>
          <IconButton icon={X} label="Close workspace" onPress={props.onDismiss} />
        </View>
        {props.activeProject ? <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}><Button variant="secondary" icon={Plus} label="New session" onPress={() => { props.onDismiss(); void props.onNewSession(props.activeProject!) }} /></View> : null}
        <Text style={{ paddingHorizontal: 20, paddingBottom: 8, color: colors.mutedForeground, fontSize: 12 }}>Projects</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
          {props.projects.map((project) => <View key={project.path}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === project.path }} onPress={() => {
              if (expanded === project.path) { generation.current++; setExpanded(null) }
              else void select(project)
            }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10 }}>
              {expanded === project.path ? <ChevronDown size={14} color={colors.mutedForeground} /> : <ChevronRight size={14} color={colors.mutedForeground} />}
              <Folder size={17} color={colors.mutedForeground} />
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, flex: 1 }}>{project.name}</Text>
            </Pressable>
            {expanded === project.path ? <View style={{ paddingLeft: 16, gap: 2 }}>
              <Button variant="ghost" icon={Plus} label="New session here" onPress={() => { props.onDismiss(); void props.onNewSession(project) }} />
              {busy ? <ActivityIndicator style={{ padding: 12 }} color={colors.mutedForeground} /> : null}
              {error ? <Text style={{ color: colors.error, padding: 12 }}>{error}</Text> : null}
              {!busy && !error && !rows.length ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>No sessions yet</Text> : null}
              {rows.map((session) => <Pressable key={session.sessionId} accessibilityRole="button" onPress={() => { props.onDismiss(); void props.onOpenSession(project, session) }} style={({ pressed }) => ({ borderRadius: radius.md, opacity: pressed ? 0.7 : 1 })}>
                <SessionRowContent session={session} selected={session.sessionId === props.activeSessionId} />
              </Pressable>)}
            </View> : null}
          </View>)}
        </ScrollView>
      </View>
    </View>
  </Modal>
}
