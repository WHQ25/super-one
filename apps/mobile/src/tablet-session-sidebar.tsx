import { FlatList, Pressable, Text, View } from 'react-native'
import { styles } from './styles'

export type TabletSessionRow = {
  sessionId: string
  title: string
  lastActiveAt?: string
  provider?: string
}

export function SessionList(props: {
  sessions: TabletSessionRow[]
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
}) {
  return (
    <>
      <Pressable style={styles.btn} onPress={props.onCreateSession}>
        <Text style={styles.btnText}>New session</Text>
      </Pressable>
      <FlatList
        data={props.sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => props.onOpenSession(item)}>
            <Text style={styles.rowTitle}>{item.title || item.sessionId.slice(0, 8)}</Text>
            <Text style={styles.rowMeta}>{item.provider ?? ''} {item.lastActiveAt ?? ''}</Text>
          </Pressable>
        )}
      />
    </>
  )
}

export function TabletSessionSidebar(props: {
  projectName: string
  sessions: TabletSessionRow[]
  activeSessionId: string | null
  onOpenSession: (session: TabletSessionRow) => void
  onCreateSession: () => void
  onOpenSettings: () => void
}) {
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
