import { ChevronUp, File, Folder } from 'lucide-react-native'
import { FlatList, Pressable, Text, View } from 'react-native'
import { directoryEntryAction, parentRemotePath, type RemoteDirectoryEntry } from '../shell-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'

export function FilesScreen(props: {
  path: string
  items: RemoteDirectoryEntry[]
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  return (
    <View style={styles.flex}>
      <View style={styles.pathBar}>
        <Pressable style={styles.pathUp} onPress={() => props.onOpenDirectory(parentRemotePath(props.path))}>
          <ChevronUp color={tokens.colors.primary} size={18} />
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
            <ListRow
              title={item.name}
              subtitle={item.isDirectory ? 'Directory' : 'Open or share file'}
              leading={item.isDirectory
                ? <Folder color={tokens.colors.primary} size={21} />
                : <File color={tokens.colors.mutedForeground} size={21} />}
              onPress={() => action.kind === 'directory'
                ? props.onOpenDirectory(action.path)
                : props.onOpenFile(action.path)}
            />
          )
        }}
      />
    </View>
  )
}
