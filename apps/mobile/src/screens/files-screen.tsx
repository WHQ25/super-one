import { ChevronRight, FolderOpen, FolderPlus, Upload } from 'lucide-react-native'
import { FileTypeIcon } from '../ui/file-icon'
import { useRef } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../ui/text'
import {
  directoryEntryAction,
  fileBrowserCrumbs,
  joinRemotePath,
  repoRelativePath,
  type FileBrowserMode,
  type RemoteDirectoryEntry,
} from '../shell-state'
import type { GitToneMap } from '../navigation/use-project-git-status'
import type { GitFileTone } from '@superone/shared/git-file-status'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Button, ListRow } from '../ui'

/**
 * Semantic role → mobile palette. The role comes from `@superone/shared`, which
 * the desktop tree reads too, so the two never disagree on what a colour means
 * even though the palettes differ.
 */
function toneColor(tone: GitFileTone, colors: ReturnType<typeof useMobileTheme>['tokens']['colors']): string {
  if (tone === 'added') return colors.success
  if (tone === 'deleted') return colors.error
  if (tone === 'conflict') return colors.warning
  if (tone === 'renamed') return colors.primary
  if (tone === 'ignored') return colors.mutedForeground
  return colors.warning
}

/**
 * The project's (or the host's) file tree.
 *
 * Project mode is fenced to one working directory the way the desktop's tree is:
 * there is no "up" past the root, and the header's folder name is the only way
 * back to it. Computer mode drops the fence for the folder-picking cases.
 */
export function FilesScreen(props: {
  mode: FileBrowserMode
  path: string
  items: RemoteDirectoryEntry[]
  loading?: boolean
  error?: string
  /** Git state keyed by repo-relative path; empty outside a repository. */
  gitTones?: GitToneMap
  onRefresh: () => void
  onNewFolder: () => void
  onUploadFile: () => void
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const insets = useSafeAreaInsets()
  const breadcrumbs = useRef<ScrollView>(null)
  const crumbs = fileBrowserCrumbs(props.mode, props.path)
  const gitRoot = props.mode.kind === 'project' ? props.mode.root : null

  const toneFor = (entry: RemoteDirectoryEntry): GitFileTone | null => {
    if (!gitRoot || !props.gitTones) return null
    const relative = repoRelativePath(gitRoot, joinRemotePath(props.path, entry.name))
    if (relative == null || relative === '') return null
    return entry.isDirectory
      ? props.gitTones.directories.get(relative) ?? null
      : props.gitTones.files.get(relative)?.tone ?? null
  }
  const stagedFor = (entry: RemoteDirectoryEntry): boolean => {
    if (!gitRoot || !props.gitTones || entry.isDirectory) return true
    const relative = repoRelativePath(gitRoot, joinRemotePath(props.path, entry.name))
    return relative == null ? true : props.gitTones.files.get(relative)?.staged ?? true
  }

  return (
    <View style={styles.flex}>
      {/* Nothing else lives on this row, so at the root it has nothing to say. */}
      {crumbs.length ? <View style={styles.pathBar}>
        {/* Deep paths run off the right edge, so the tail — where the user is — is
            what stays visible; earlier segments scroll back into view. */}
        <ScrollView ref={breadcrumbs} onContentSizeChange={() => breadcrumbs.current?.scrollToEnd({ animated: false })} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 4 }}>
          {crumbs.map((crumb, index) => <View key={crumb.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {index ? <ChevronRight size={12} color={tokens.colors.mutedForeground} /> : null}
            <Pressable accessibilityRole="button" onPress={() => props.onOpenDirectory(crumb.path)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}>
              <Text style={{ color: crumb.path === props.path ? tokens.colors.foreground : tokens.colors.mutedForeground, fontSize: 13 }}>{crumb.label}</Text>
            </Pressable>
          </View>)}
        </ScrollView>
      </View> : null}
      <FlatList
        data={props.items}
        // Pull to refresh instead of a button: the gesture is already where the
        // user's thumb is, and a folder listing is exactly what it means everywhere else.
        refreshControl={<RefreshControl refreshing={!!props.loading && props.items.length > 0}
          onRefresh={props.onRefresh} tintColor={tokens.colors.mutedForeground} />}
        contentContainerStyle={!props.items.length ? { flexGrow: 1 } : undefined}
        ListEmptyComponent={<View style={styles.emptyState}>
          {props.loading ? <ActivityIndicator color={tokens.colors.mutedForeground} /> : <FolderOpen size={36} color={tokens.colors.mutedForeground} />}
          <Text style={props.error ? styles.errorText : styles.emptyBody}>{props.loading ? 'Loading folder…' : props.error || 'This folder is empty'}</Text>
          {props.error ? <Button label="Try again" variant="secondary" onPress={() => props.onOpenDirectory(props.path)} /> : null}
        </View>}
        keyExtractor={(item) => `${item.isDirectory ? 'd' : 'f'}:${item.name}`}
        renderItem={({ item }) => {
          const action = directoryEntryAction(props.path, item)
          const tone = toneFor(item)
          return (
            <ListRow
              title={item.name}
              subtitle={undefined}
              titleColor={tone ? toneColor(tone, tokens.colors) : undefined}
              // Unstaged and ignored files read as present but not yet part of the
              // commit — the same dimming the desktop tree applies.
              titleOpacity={tone && (tone === 'ignored' || !stagedFor(item)) ? 0.6 : undefined}
              leading={<FileTypeIcon name={item.name} directory={item.isDirectory} size={21} />}
              onPress={() => action.kind === 'directory'
                ? props.onOpenDirectory(action.path)
                : props.onOpenFile(action.path)}
            />
          )
        }}
      />
      <View style={[styles.fileActionBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.flex}><Button label="Upload file" variant="secondary" icon={Upload} onPress={props.onUploadFile} /></View>
        <View style={styles.flex}><Button label="New folder" variant="secondary" icon={FolderPlus} onPress={props.onNewFolder} /></View>
      </View>
    </View>
  )
}
