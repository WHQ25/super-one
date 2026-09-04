import { Folder, FolderOpen } from 'lucide-react-native'
import { FlatList, Text, View } from 'react-native'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, ListRow } from '../ui'
import type { ShellGitInfo } from './settings-screen'

export type Project = { path: string; name: string; git?: ShellGitInfo }

export function ProjectsScreen(props: { projects: Project[]; onOpen: (project: Project) => void }) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  if (!props.projects.length) {
    return (
      <View style={styles.emptyState}>
        <FolderOpen color={tokens.colors.border} size={48} />
        <Text style={styles.emptyTitle}>No projects yet</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={props.projects}
      keyExtractor={(item) => item.path}
      renderItem={({ item }) => (
        <ListRow
          title={item.name}
          subtitle={item.path}
          leading={<Folder color={tokens.colors.primary} size={22} />}
          trailing={item.git ? (
            <View style={styles.projectIndicators}>
              {item.git.branch ? <Badge label={item.git.branch} /> : null}
              {item.git.ahead ? <Badge label={`↑${item.git.ahead}`} tone="success" /> : null}
              {item.git.behind ? <Badge label={`↓${item.git.behind}`} tone="warning" /> : null}
              {item.git.dirty?.files ? <Badge label={`${item.git.dirty.files} changed`} tone="warning" /> : null}
            </View>
          ) : undefined}
          onPress={() => props.onOpen(item)}
        />
      )}
    />
  )
}
