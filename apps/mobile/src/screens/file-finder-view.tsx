import { Folder, Search, TextCursorInput } from 'lucide-react-native'
import { ActivityIndicator, FlatList, TextInput, View } from 'react-native'
import type { FileSearchResult } from '@superone/shared/agent-types'
import type { RemoteDirectoryEntry } from '../shell-state'
import { FileTypeIcon } from '../ui/file-icon'
import { Text } from '../ui/text'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'

/** Trailing path segment and the folder that holds it, for a two-line result row. */
export function splitSearchPath(path: string): { name: string; parent: string } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  return slash === -1
    ? { name: normalized, parent: '' }
    : { name: normalized.slice(slash + 1), parent: normalized.slice(0, slash) }
}

export type FileFinderSearch = {
  kind: 'search'
  /** Root the results are relative to, so rows can show a short path. */
  root: string
  results: FileSearchResult[]
  searched: boolean
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}

export type FileFinderGoTo = {
  kind: 'goto'
  suggestions: RemoteDirectoryEntry[]
  /** Complete the trailing segment without leaving the field. */
  onComplete: (name: string) => void
  /** Commit the typed path. */
  onSubmit: () => void
}

/**
 * The one overlay the browser's header toggle opens.
 *
 * A project is a tree the user knows by filename, so it searches. The whole
 * machine is not — there is no useful fuzzy match over every file on a laptop,
 * and the thing a person actually wants there is to type a path they already
 * have in mind. Same field, same list, different question.
 */
export function FileFinderView(props: {
  query: string
  busy: boolean
  onQuery: (value: string) => void
  finder: FileFinderSearch | FileFinderGoTo
}) {
  const styles = useMobileStyles()
  const { tokens: { colors, radius } } = useMobileTheme()
  const goto = props.finder.kind === 'goto' ? props.finder : null
  const search = props.finder.kind === 'search' ? props.finder : null
  const Glyph = goto ? TextCursorInput : Search

  return (
    <View style={styles.flex}>
      {/* No close button: the header's toggle is the way out, so a second control
          claiming the same state would only be a way for the two to disagree. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10,
          borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Glyph size={15} color={colors.mutedForeground} />
          <TextInput
            accessibilityLabel={goto ? 'Folder path' : 'Search files'}
            autoFocus
            value={props.query}
            onChangeText={props.onQuery}
            placeholder={goto ? '/path/to/folder' : 'Search files'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType={goto ? 'go' : 'search'}
            onSubmitEditing={goto ? goto.onSubmit : undefined}
            style={{ flex: 1, color: colors.foreground, fontSize: 15, paddingVertical: 10 }}
          />
          {props.busy ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
        </View>
      </View>
      {goto ? (
        <FlatList
          data={goto.suggestions}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={!goto.suggestions.length ? { flexGrow: 1 } : undefined}
          ListEmptyComponent={<View style={styles.emptyState}>
            <Text style={styles.emptyBody}>{props.busy ? 'Reading folder…' : 'No matching folders'}</Text>
          </View>}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => <ListRow
            title={item.name}
            leading={<Folder size={19} color={colors.mutedForeground} />}
            onPress={() => goto.onComplete(item.name)}
          />}
        />
      ) : search ? (
        <FlatList
          data={search.results}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={!search.results.length ? { flexGrow: 1 } : undefined}
          ListEmptyComponent={<View style={styles.emptyState}>
            <Text style={styles.emptyBody}>
              {!props.query.trim() ? 'Type to search this folder tree'
                : search.searched ? 'No matching files' : 'Searching…'}
            </Text>
          </View>}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => {
            const { name, parent } = splitSearchPath(item.path)
            const relative = search.root && parent.startsWith(search.root)
              ? parent.slice(search.root.length).replace(/^\//, '') : parent
            return <ListRow
              title={name}
              subtitle={relative || undefined}
              leading={<FileTypeIcon name={name} directory={item.isDirectory} size={21} />}
              onPress={() => item.isDirectory ? search.onOpenDirectory(item.path) : search.onOpenFile(item.path)}
            />
          }}
        />
      ) : null}
    </View>
  )
}
