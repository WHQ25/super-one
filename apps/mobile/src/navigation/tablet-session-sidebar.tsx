import { FlatList, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId } from '@superone/shared/agent-types'
import { useMobileStyles } from '../theme/context'
import { Button, SwipeSessionRow } from '../ui'
import { SessionRowContent } from '../ui/session-row-content'

export type TabletSessionRow = {
  sessionId: string
  title: string
  lastActiveAt?: string
  provider?: HarnessId
  acpAgentId?: string | null
  messageCount?: number
  gitBranch?: string
  selectedModel?: string | null
  status?: string
  tags?: string[]
}

export function TabletSessionSidebar(props: {
  projectName: string
  sessions: TabletSessionRow[]
  activeSessionId: string | null
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
  onOpenSettings: () => void
  onArchiveSession: (session: TabletSessionRow) => void
  onDeleteSession: (session: TabletSessionRow) => void
}) {
  const styles = useMobileStyles()
  return (
    <View style={styles.tabletSidebar}>
      <Text numberOfLines={1} style={styles.sectionTitle}>{props.projectName}</Text>
      <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
        <Button variant="ghost" label="New session" onPress={props.onCreateSession} />
        <Button variant="ghost" label="Settings" onPress={props.onOpenSettings} />
      </View>
      <FlatList
        style={styles.flex}
        data={props.sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => (
          <SwipeSessionRow
            title={item.title}
            onPress={() => props.onOpenSession(item)}
            onArchive={() => props.onArchiveSession(item)}
            onDelete={() => props.onDeleteSession(item)}
          >
            <SessionRowContent session={item} selected={props.activeSessionId === item.sessionId} />
          </SwipeSessionRow>
        )}
      />
    </View>
  )
}
