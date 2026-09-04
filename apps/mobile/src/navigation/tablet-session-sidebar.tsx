import { FlatList, Pressable, Text, View } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { HarnessIcon, SwipeSessionRow } from '../ui'

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
  const { tokens } = useMobileTheme()
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
          <SwipeSessionRow
            title={item.title}
            onPress={() => props.onOpenSession(item)}
            onArchive={() => props.onArchiveSession(item)}
            onDelete={() => props.onDeleteSession(item)}
          >
            <View style={[
              styles.row,
              { backgroundColor: tokens.colors.background },
              props.activeSessionId === item.sessionId ? styles.selectedRow : null,
            ]}>
              <View style={styles.sessionTitleRow}>
                <HarnessIcon
                  provider={item.provider ?? 'claude'}
                  acpAgentId={item.acpAgentId}
                  status={item.status}
                  size={18}
                />
                <Text numberOfLines={1} style={[styles.rowTitle, styles.flex]}>{item.title || item.sessionId.slice(0, 8)}</Text>
              </View>
              <Text numberOfLines={1} style={styles.rowMeta}>
                {item.provider ?? ''}{item.selectedModel ? ` · ${item.selectedModel}` : ''}{item.status === 'streaming' ? ' · streaming' : ''}
              </Text>
            </View>
          </SwipeSessionRow>
        )}
      />
    </View>
  )
}
