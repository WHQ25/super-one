import { MessageSquare } from 'lucide-react-native'
import { FlatList, Text, View } from 'react-native'
import type { TabletSessionRow } from '../navigation/tablet-session-sidebar'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { harnessDisplayName } from '../provider-state'
import { Badge, Button, SwipeSessionRow } from '../ui'

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
  onArchiveSession: (session: TabletSessionRow) => void
  onDeleteSession: (session: TabletSessionRow) => void
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
          <SwipeSessionRow
            title={item.title}
            onPress={() => props.onOpenSession(item)}
            onArchive={() => props.onArchiveSession(item)}
            onDelete={() => props.onDeleteSession(item)}
          >
            <View style={[styles.sessionCard, isRecent(item.lastActiveAt) ? styles.sessionRecent : null]}>
              <Text numberOfLines={2} style={styles.rowTitle}>{item.title || 'Untitled'}</Text>
              <View style={styles.sessionMeta}>
                <Badge label={harnessDisplayName(item.provider ?? 'claude')} />
                {item.selectedModel ? <Badge label={item.selectedModel} /> : null}
                {item.status === 'streaming' ? <Badge label="Streaming" tone="success" /> : null}
                {typeof item.messageCount === 'number' ? <Badge label={`${item.messageCount} messages`} /> : null}
                {item.lastActiveAt ? <Badge label={relativeTime(item.lastActiveAt)} tone={isRecent(item.lastActiveAt) ? 'success' : 'neutral'} /> : null}
                {item.gitBranch ? <Badge label={item.gitBranch} /> : null}
                {item.tags?.map((tag) => <Badge key={tag} label={tag} />)}
              </View>
            </View>
          </SwipeSessionRow>
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
