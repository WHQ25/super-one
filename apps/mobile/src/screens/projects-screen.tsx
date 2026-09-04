import { Folder, FolderOpen } from 'lucide-react-native'
import { FlatList, Text, View } from 'react-native'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'

export type Project = { path: string; name: string }

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
          onPress={() => props.onOpen(item)}
        />
      )}
    />
  )
}
