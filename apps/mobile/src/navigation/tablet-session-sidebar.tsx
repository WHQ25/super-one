import { ScrollView, View } from 'react-native'
import { Plus, Settings } from 'lucide-react-native'
import { Text } from '../ui/text'
import type { RelayClient } from '@superone/relay-client'
import type { Project } from '../project-types'
import type { SessionListRow } from '../session-list-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { IconButton, SessionListBody, type SessionListActions } from '../ui'
import { useProjectSessions } from './use-project-sessions'

/** The master pane at tablet widths; same surface and rows as the drawer. */
export function TabletSessionSidebar(props: SessionListActions & {
  client: RelayClient | null
  project: Project
  sessions: SessionListRow[]
  activeSessionId: string | null
  onCreateSession: () => void
  onOpenSettings: () => void
}) {
  const styles = useMobileStyles()
  const { tokens: { colors } } = useMobileTheme()
  const sessions = useProjectSessions(props.client, props.project, props.sessions, props.activeSessionId)
  return (
    <View style={styles.tabletSidebar}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 13, fontWeight: '600' }}>
          {props.project.name}
        </Text>
        <IconButton icon={Plus} label="New session" onPress={props.onCreateSession} chrome="plain" color={colors.foreground} />
        <IconButton icon={Settings} label="Settings" onPress={props.onOpenSettings} />
      </View>
      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled">
        <SessionListBody
          sessions={sessions}
          surface="panel"
          activeSessionId={props.activeSessionId}
          onOpenSession={props.onOpenSession}
          onPinSession={props.onPinSession}
          onArchiveSession={props.onArchiveSession}
          onDeleteSession={props.onDeleteSession}
        />
      </ScrollView>
    </View>
  )
}
