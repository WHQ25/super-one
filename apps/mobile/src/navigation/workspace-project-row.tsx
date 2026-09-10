import { useContext, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react-native'
import type { RelayClient } from '@superone/relay-client'
import { Text } from '../ui/text'
import { SessionListBody, type SessionListActions } from '../ui'
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
  // Mounted the first time this project is expanded, and kept mounted after.
  // Collapsing hides the ordinary list instead of dropping it, so re-expanding
  // costs no request. Attention is the desktop exception: a collapsed project
  // still shows sessions waiting on the user, so those rows arm the list too.
  const [armed, setArmed] = useState(props.expanded || needsAttention)
  useEffect(() => { if (props.expanded || needsAttention) setArmed(true) }, [props.expanded, needsAttention])
  const Chevron = props.expanded ? ChevronDown : ChevronRight

  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: props.expanded }}
      onPress={props.onToggle}
      style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
      <Folder size={16} color={colors.mutedForeground} />
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, flex: 1 }}>{props.project.name}</Text>
      <Chevron size={14} color={colors.mutedForeground} />
    </Pressable>
    {armed ? <ProjectSessions {...props} /> : null}
  </View>
}

/**
 * Separate component so the hook only ever exists for a project that has been
 * expanded — mounting it in `WorkspaceProjectRow` would fetch every project in
 * the drawer the moment it opened.
 */
function ProjectSessions(props: WorkspaceProjectRowProps) {
  const sessions = useProjectSessions(
    props.client,
    props.project,
    props.seed ?? [],
    props.activeSessionId,
    props.expanded,
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

  const showList = props.expanded || sessions.items.length > 0
  return <View style={{ paddingLeft: 8, paddingBottom: 4, display: showList ? 'flex' : 'none' }}>
    <SessionListBody
      sessions={sessions}
      surface="panel"
      collapsed={!props.expanded}
      activeSessionId={props.activeSessionId}
      onOpenSession={props.onOpenSession}
      onPinSession={props.onPinSession}
      onArchiveSession={props.onArchiveSession}
      onDeleteSession={props.onDeleteSession}
    />
  </View>
}
