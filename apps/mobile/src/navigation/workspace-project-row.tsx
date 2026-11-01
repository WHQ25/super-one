import { useContext, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight, Folder, LoaderCircle } from 'lucide-react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import type { RelayClient } from '@superone/relay-client'
import { Text } from '../ui/text'
import { SessionListBody, type SessionListActions } from '../ui'
import { SettledSessionSection } from '../ui/settled-session-section'
import { SESSION_UNFOLD } from '../ui/session-unfold'
import { SpinningIcon } from '../ui/spinning-icon'
import { useIconMotion } from '../ui/use-icon-motion'
import type { Project } from '../project-types'
import type { SessionListRow } from '../session-list-state'
import { projectHasAttention } from '../session-activity-state'
import type { WorkspaceListCache } from '../workspace-list-cache'
import { useMobileTheme } from '../theme/context'
import { SessionActivityContext } from './use-session-activity'
import { useProjectSessions } from './use-project-sessions'
import { useSettledSessions } from './use-settled-sessions'

export type WorkspaceProjectRowProps = SessionListActions & {
  client: RelayClient | null
  project: Project
  /** Lists read earlier over this connection; a remount starts from here, not from a request. */
  cache: WorkspaceListCache
  expanded: boolean
  onToggle: () => void
  /** Rows the shell already holds for this project; avoids an empty first paint. */
  seed?: SessionListRow[]
  activeSessionId: string | null
  /** The panel is on screen — a hidden drawer has no reason to re-read. */
  visible: boolean
  /** The shell's tick for a host invalidation; the cache knows whether it named this project. */
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
  // opened. A list already in the cache arms for free — it is not a request.
  const [armed, setArmed] = useState(props.expanded || needsAttention || props.cache.get(props.project.path) !== undefined)
  useEffect(() => { if (props.expanded || needsAttention) setArmed(true) }, [props.expanded, needsAttention])
  // Only a tap on this row plays the unfold. The list opens the active project
  // on its own every time the drawer mounts, and rows sliding in on an
  // expansion nobody asked for read as the list being re-fetched.
  const [tapped, setTapped] = useState(false)
  const animate = useIconMotion() && tapped

  const sessions = useProjectSessions({
    client: props.client,
    project: props.project,
    cache: props.cache,
    seed: props.seed,
    activeSessionId: props.activeSessionId,
    listExpanded: props.expanded,
    armed,
    visible: props.visible,
    listRevision: props.listRevision,
  })
  const settled = useSettledSessions({
    client: props.client,
    path: props.project.path,
    cache: props.cache,
    enabled: props.expanded,
    visible: props.visible,
    listRevision: props.listRevision,
  })
  const [settledOpen, setSettledOpen] = useState(() => props.cache.settledOpenPaths.has(props.project.path))
  const toggleSettled = () => {
    const next = !settledOpen
    const paths = new Set(props.cache.settledOpenPaths)
    if (next) paths.add(props.project.path)
    else paths.delete(props.project.path)
    props.cache.settledOpenPaths = paths
    setSettledOpen(next)
  }
  const { expanded } = props

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
        onSettleSession={props.onSettleSession}
        onDeleteSession={props.onDeleteSession}
      />
      {expanded ? <SettledSessionSection
        rows={settled.rows}
        total={settled.total}
        open={settledOpen}
        onToggle={toggleSettled}
        busy={settled.busy}
        loadingMore={settled.loadingMore}
        // The active list already prints a project-wide host failure. Repeating
        // it under Settled makes one outage look like two.
        error={settled.error && settled.error !== sessions.error ? settled.error : undefined}
        hasMore={settled.hasMore}
        onLoadMore={settled.loadMore}
        activeSessionId={props.activeSessionId}
        surface="panel"
        onOpenSession={props.onOpenSession}
        onSettleSession={(session) => {
          void props.onSettleSession(session, false).then((ok) => { if (ok) settled.forget(session.sessionId) })
        }}
        onDeleteSession={(session) => {
          void props.onDeleteSession(session).then((ok) => { if (ok) settled.forget(session.sessionId) })
        }}
      /> : null}
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
