import { FlatList, Pressable, Text } from 'react-native'
import { styles } from './styles'

export type Project = { path: string; name: string }

export function ProjectList(props: { projects: Project[]; onOpen: (project: Project) => void }) {
  return (
    <FlatList
      data={props.projects}
      keyExtractor={(item) => item.path}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => props.onOpen(item)}>
          <Text style={styles.rowTitle}>{item.name}</Text>
          <Text style={styles.rowMeta}>{item.path}</Text>
        </Pressable>
      )}
    />
  )
}
