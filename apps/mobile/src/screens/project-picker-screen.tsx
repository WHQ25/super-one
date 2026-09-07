import { useState } from 'react'
import { Check, Folder, FolderOpen, Search } from 'lucide-react-native'
import { FlatList, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import type { Project } from '../project-types'
import { filterProjects } from '../project-picker-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'

/**
 * Choose which project the next session runs in.
 *
 * Selection only — adding a project is its own flow behind the header action,
 * the same split the desktop makes between its sidebar list and the Add Project
 * dialog. Rows carry the branch and dirty-file indicators the sidebar shows.
 */
export function ProjectPickerScreen(props: {
  projects: Project[]
  activePath?: string
  onSelect: (project: Project) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const { colors } = tokens
  const [query, setQuery] = useState('')
  const matches = filterProjects(props.projects, query)
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Search size={15} color={colors.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} accessibilityLabel="Search projects"
          placeholder="Search projects…" placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none" autoCorrect={false}
          style={{ flex: 1, minHeight: 44, fontSize: 14, color: colors.foreground }} />
      </View>
      {matches.length ? (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={item.path}
              leading={<Folder color={colors.mutedForeground} size={22} />}
              trailing={item.path === props.activePath || item.git ? (
                <View style={styles.projectIndicators}>
                  {item.path === props.activePath
                    ? <Check color={colors.primary} size={16} /> : null}
                  {item.git ? <>
                    <Text numberOfLines={1} style={styles.rowMeta}>{item.git.branch}</Text>
                    {item.git.dirty?.files ? <Text style={{ color: colors.warning, fontSize: 12 }}>{item.git.dirty.files} changed</Text> : null}
                    {item.git.ahead || item.git.behind ? <Text style={styles.rowMeta}>↑{item.git.ahead ?? 0} ↓{item.git.behind ?? 0}</Text> : null}
                  </> : null}
                </View>
              ) : undefined}
              onPress={() => props.onSelect(item)}
            />
          )}
        />
      ) : (
        <View style={styles.emptyState}>
          <FolderOpen color={colors.border} size={48} />
          <Text style={styles.emptyTitle}>{query.trim() ? 'No projects matched' : 'No projects yet'}</Text>
          <Text style={styles.emptyBody}>Add one with the button in the top right.</Text>
        </View>
      )}
    </View>
  )
}
