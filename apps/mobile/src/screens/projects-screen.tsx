import { Check, Folder, FolderOpen } from 'lucide-react-native'
import { FlatList, View } from 'react-native'
import { Text } from '../ui/text'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'
import type { ShellGitInfo } from './settings-screen'

export type Project = { path: string; name: string; git?: ShellGitInfo }

export function ProjectsScreen(props: {
  projects: Project[]
  /** Marks the project the shell is already on, when there is one. */
  activePath?: string
  onOpen: (project: Project) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  if (!props.projects.length) {
    return (
      <View style={styles.emptyState}>
        <FolderOpen color={tokens.colors.border} size={48} />
        <Text style={styles.emptyTitle}>No projects yet</Text>
        <Text style={styles.emptyBody}>Open a project in SuperOne desktop to find it here.</Text>
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
          leading={<Folder color={tokens.colors.mutedForeground} size={22} />}
          trailing={item.path === props.activePath || item.git ? (
            <View style={styles.projectIndicators}>
              {item.path === props.activePath
                ? <Check color={tokens.colors.primary} size={16} /> : null}
              {item.git ? <>
                <Text numberOfLines={1} style={styles.rowMeta}>{item.git.branch}</Text>
                {item.git.dirty?.files ? <Text style={{ color: tokens.colors.warning, fontSize: 12 }}>{item.git.dirty.files} changed</Text> : null}
                {item.git.ahead || item.git.behind ? <Text style={styles.rowMeta}>↑{item.git.ahead ?? 0} ↓{item.git.behind ?? 0}</Text> : null}
              </> : null}
            </View>
          ) : undefined}
          onPress={() => props.onOpen(item)}
        />
      )}
    />
  )
}
