import { MessageSquare, Plus } from 'lucide-react-native'
import { FlatList, View } from 'react-native'
import { Text } from '../ui/text'
import type { TabletSessionRow } from '../navigation/tablet-session-sidebar'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Button, SwipeSessionRow } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'

export function SessionsScreen(props: {
  sessions: TabletSessionRow[]
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
  onArchiveSession: (session: TabletSessionRow) => void
  onDeleteSession: (session: TabletSessionRow) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <View style={styles.flex}>
      <View style={{ paddingBottom: 12 }}><Button label="New session" icon={Plus} variant="secondary" onPress={props.onCreateSession} /></View>
      {!props.sessions.length ? (
        <View style={styles.emptyState}>
          <MessageSquare color={tokens.colors.border} size={48} />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
        </View>
      ) : null}
      <FlatList
        data={props.sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => (
          <SwipeSessionRow
            title={item.title}
            onPress={() => props.onOpenSession(item)}
            onArchive={() => props.onArchiveSession(item)}
            onDelete={() => props.onDeleteSession(item)}
          >
            <SessionRowContent session={item} />
          </SwipeSessionRow>
        )}
      />
    </View>
  )
}
