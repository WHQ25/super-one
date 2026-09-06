import { ArrowUp, ChevronRight, FolderOpen } from 'lucide-react-native'
import { FileTypeIcon } from '../ui/file-icon'
import { useRef } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { directoryEntryAction, parentRemotePath, remoteBreadcrumbs, type RemoteDirectoryEntry } from '../shell-state'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Button, IconButton, ListRow } from '../ui'

export function FilesScreen(props: {
  path: string
  items: RemoteDirectoryEntry[]
  loading?: boolean
  error?: string
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const breadcrumbs = useRef<ScrollView>(null)
  return (
    <View style={styles.flex}>
      <View style={styles.pathBar}>
        <IconButton icon={ArrowUp} label="Parent directory" onPress={() => props.onOpenDirectory(parentRemotePath(props.path))} />
        <ScrollView ref={breadcrumbs} onContentSizeChange={() => breadcrumbs.current?.scrollToEnd({ animated: false })} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
          {remoteBreadcrumbs(props.path).map((crumb, index) => <View key={crumb.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {index ? <ChevronRight size={12} color={tokens.colors.mutedForeground} /> : null}
            <Pressable accessibilityRole="button" onPress={() => props.onOpenDirectory(crumb.path)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
              <Text style={{ color: crumb.path === props.path ? tokens.colors.foreground : tokens.colors.mutedForeground, fontSize: 13 }}>{crumb.label}</Text>
            </Pressable>
          </View>)}
        </ScrollView>
      </View>
      <FlatList
        data={props.items}
        contentContainerStyle={!props.items.length ? { flexGrow: 1 } : undefined}
        ListEmptyComponent={<View style={styles.emptyState}>
          {props.loading ? <ActivityIndicator color={tokens.colors.mutedForeground} /> : <FolderOpen size={36} color={tokens.colors.mutedForeground} />}
          <Text style={props.error ? styles.errorText : styles.emptyBody}>{props.loading ? 'Loading folder…' : props.error || 'This folder is empty'}</Text>
          {props.error ? <Button label="Try again" variant="secondary" onPress={() => props.onOpenDirectory(props.path)} /> : null}
        </View>}
        keyExtractor={(item) => `${item.isDirectory ? 'd' : 'f'}:${item.name}`}
        renderItem={({ item }) => {
          const action = directoryEntryAction(props.path, item)
          return (
            <ListRow
              title={item.name}
              subtitle={undefined}
              leading={<FileTypeIcon name={item.name} directory={item.isDirectory} size={21} />}
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
