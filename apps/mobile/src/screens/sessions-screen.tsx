import { MessageSquare } from 'lucide-react-native'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { TabletSessionRow } from '../navigation/tablet-session-sidebar'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, Button } from '../ui'

function relativeTime(value?: string): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d`
  return new Date(time).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
}

export function SessionsScreen(props: {
  sessions: TabletSessionRow[]
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <View style={styles.flex}>
      <Button label="New session" onPress={props.onCreateSession} />
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
          <Pressable
            style={[styles.sessionCard, isRecent(item.lastActiveAt) ? styles.sessionRecent : null]}
            onPress={() => props.onOpenSession(item)}
          >
            <Text numberOfLines={2} style={styles.rowTitle}>{item.title || 'Untitled'}</Text>
            <View style={styles.sessionMeta}>
              <Badge label={item.provider ?? 'claude'} />
              {'messageCount' in item && typeof item.messageCount === 'number' ? <Badge label={`${item.messageCount} messages`} /> : null}
              {item.lastActiveAt ? <Badge label={relativeTime(item.lastActiveAt)} tone={isRecent(item.lastActiveAt) ? 'success' : 'neutral'} /> : null}
              {'gitBranch' in item && typeof item.gitBranch === 'string' ? <Badge label={item.gitBranch} /> : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}

function isRecent(value?: string): boolean {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && Date.now() - time < 2 * 60 * 60 * 1_000
}
