import { useContext, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight, Folder, LoaderCircle } from 'lucide-react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import type { RelayClient } from '@superone/relay-client'
import { Text } from '../ui/text'
import { SessionListBody, type SessionListActions } from '../ui'
import { SESSION_UNFOLD } from '../ui/session-unfold'
import { SpinningIcon } from '../ui/spinning-icon'
import { useIconMotion } from '../ui/use-icon-motion'
import type { Project } from '../project-types'
import type { SessionListRow } from '../session-list-state'
import { projectHasAttention } from '../session-activity-state'
import { useMobileTheme } from '../theme/context'
import { SessionActivityContext } from './use-session-activity'
import { useProjectSessions } from './use-project-sessions'

export type WorkspaceProjectRowProps = SessionListActions & {
  client: RelayClient | null
  project: Project
  expanded: boolean
  onToggle: () => void
  /** Rows the shell already holds for this project; avoids an empty first paint. */
  seed?: SessionListRow[]
  activeSessionId: string | null
  /** The panel is on screen — a hidden drawer has no reason to re-read. */
  visible: boolean
  /** The host's session-list invalidation counter; a bump is what triggers a re-read. */
  listRevision: number
}

/**
 * One project in the drawer, owning its own session list.
 *
 * The list is per row rather than per drawer because expansion is per row: the
 * desktop sidebar lets several projects stand open at once, and a single shared
 * list state could only ever serve one of them, which is what made this an
 * accordion.
 */
export function WorkspaceProjectRow(props: WorkspaceProjectRowProps) {
  const { tokens: { colors } } = useMobileTheme()
  const needsAttention = projectHasAttention(useContext(SessionActivityContext), props.project.path)
  // Read the first time this project is expanded, and kept after. Collapsing
  // hides the ordinary list instead of dropping it, so re-expanding costs no
  // request. Live work is the desktop exception: a collapsed project still
  // shows running, unseen, and pending sessions, so those rows arm the list
  // too. Without the gate every project would fetch the moment the drawer
  // opened.
  const [armed, setArmed] = useState(props.expanded || needsAttention)
  useEffect(() => { if (props.expanded || needsAttention) setArmed(true) }, [props.expanded, needsAttention])
  // Only a tap on this row plays the unfold. The list opens the active project
  // on its own every time the drawer mounts, and rows sliding in on an
  // expansion nobody asked for read as the list being re-fetched.
  const [tapped, setTapped] = useState(false)
  const animate = useIconMotion() && tapped

  const sessions = useProjectSessions(
    props.client,
    props.project,
    props.seed ?? [],
    props.activeSessionId,
    props.expanded,
    armed,
  )
  const { refresh } = sessions
  // The mount load is the first read; from then on only an invalidation the host
  // sent, applied when this row is both on screen and open.
  const syncedRevision = useRef(props.listRevision)
  const { visible, expanded, listRevision } = props
  useEffect(() => {
    if (!visible || !expanded || syncedRevision.current === listRevision) return
    syncedRevision.current = listRevision
    refresh()
  }, [visible, expanded, listRevision, refresh])

  // The first read takes over the folder glyph rather than sitting inside the
  // list, where it would push every seeded row down and back up again. Same
  // slot, same size: nothing else on the row moves while it spins.
  const loading = expanded && (sessions.busy || !sessions.loaded)
  const showList = expanded || sessions.items.length > 0
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded, busy: loading }}
      onPress={() => { setTapped(true); props.onToggle() }}
      style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 }}>
      <View testID={loading ? 'project-list-loading' : 'project-list-icon'} accessible={false} style={{ width: 18, height: 18 }}>
        {loading
          ? <SpinningIcon icon={LoaderCircle} size={18} color={colors.mutedForeground} />
          : <Folder size={18} color={colors.mutedForeground} />}
      </View>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, flex: 1 }}>{props.project.name}</Text>
      <ProjectChevron expanded={expanded} animate={animate} color={colors.mutedForeground} />
    </Pressable>
    {armed ? <View style={{ paddingLeft: 8, paddingBottom: showList ? 4 : 0 }}>
      <SessionListBody
        sessions={sessions}
        surface="panel"
        collapsed={!expanded}
        animate={animate}
        activeSessionId={props.activeSessionId}
        onOpenSession={props.onOpenSession}
        onPinSession={props.onPinSession}
        onArchiveSession={props.onArchiveSession}
        onDeleteSession={props.onDeleteSession}
      />
    </View> : null}
  </View>
}

function ProjectChevron({ expanded, animate, color }: { expanded: boolean; animate: boolean; color: string }) {
  const rotation = useSharedValue(expanded ? 90 : 0)
  const previous = useRef(expanded)
  useEffect(() => {
    if (previous.current === expanded) return
    previous.current = expanded
    rotation.value = animate
      ? withTiming(expanded ? 90 : 0, {
        duration: SESSION_UNFOLD.chevronMs,
        easing: Easing.bezier(...SESSION_UNFOLD.easing),
      })
      : expanded ? 90 : 0
  }, [expanded, animate, rotation])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))
  return <Animated.View style={style}>
    <ChevronRight size={15} color={color} />
  </Animated.View>
}
