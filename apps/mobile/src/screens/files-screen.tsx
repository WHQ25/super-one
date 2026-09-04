import { FlatList, Pressable, Text, View } from 'react-native'
import { directoryEntryAction, parentRemotePath, type RemoteDirectoryEntry } from '../shell-state'
import { useMobileStyles } from '../theme/context'

export function FilesScreen(props: {
  path: string
  items: RemoteDirectoryEntry[]
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const styles = useMobileStyles()
  return (
    <View style={styles.flex}>
      <View style={styles.pathBar}>
        <Pressable onPress={() => props.onOpenDirectory(parentRemotePath(props.path))}>
          <Text style={styles.back}>Up</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.directoryText}>{props.path}</Text>
      </View>
      <FlatList
        data={props.items}
        keyExtractor={(item) => `${item.isDirectory ? 'd' : 'f'}:${item.name}`}
        renderItem={({ item }) => {
          const action = directoryEntryAction(props.path, item)
          return (
            <Pressable
              style={styles.row}
              onPress={() => action.kind === 'directory'
                ? props.onOpenDirectory(action.path)
                : props.onOpenFile(action.path)}
            >
              <Text style={styles.rowTitle}>{item.isDirectory ? '▸ ' : ''}{item.name}</Text>
              <Text style={styles.rowMeta}>{item.isDirectory ? 'Directory' : 'Open or share file'}</Text>
            </Pressable>
          )
        }}
      />
    </View>
  )
}
