import { FlatList, Pressable, Text, View } from 'react-native'
import { useMobileStyles } from '../theme/context'

export type TabletSessionRow = {
  sessionId: string
  title: string
  lastActiveAt?: string
  provider?: string
  messageCount?: number
  gitBranch?: string
}

export function TabletSessionSidebar(props: {
  projectName: string
  sessions: TabletSessionRow[]
  activeSessionId: string | null
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
  onOpenSettings: () => void
}) {
  const styles = useMobileStyles()
  return (
    <View style={styles.tabletSidebar}>
      <Text numberOfLines={1} style={styles.sectionTitle}>{props.projectName}</Text>
      <View style={styles.rowBetween}>
        <Pressable style={styles.sidebarAction} onPress={props.onCreateSession}>
          <Text style={styles.back}>New session</Text>
        </Pressable>
        <Pressable style={styles.sidebarAction} onPress={props.onOpenSettings}>
          <Text style={styles.back}>Settings</Text>
        </Pressable>
      </View>
      <FlatList
        style={styles.flex}
        data={props.sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, props.activeSessionId === item.sessionId ? styles.selectedRow : null]}
            onPress={() => props.onOpenSession(item)}
          >
            <Text numberOfLines={1} style={styles.rowTitle}>{item.title || item.sessionId.slice(0, 8)}</Text>
            <Text numberOfLines={1} style={styles.rowMeta}>{item.provider ?? ''} {item.lastActiveAt ?? ''}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}
