import { Folder, Search, TextCursorInput } from 'lucide-react-native'
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native'
import type { FileSearchResult } from '@superone/shared/agent-types'
import { resolveRemoteFilePath, type RemoteDirectoryEntry } from '../shell-state'
import { FileTypeIcon } from '../ui/file-icon'
import { Text } from '../ui/text'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { ListRow } from '../ui'
import { useMobileLocale } from '../i18n/context'
import { shiftIndices } from '../mention-rows'

/**
 * Path the search row shows, and how far host match indices have to shift to
 * land on it. The host scores the inventory path; the row drops the root the
 * way an `@` file mention drops the typed directory.
 */
export function searchResultLabel(path: string, root: string): { label: string; offset: number } {
  const normalized = path.replace(/\\/g, '/')
  const prefix = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (prefix && (normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    const label = normalized.slice(prefix.length).replace(/^\//, '')
    return { label: label || normalized, offset: normalized.length - (label || normalized).length }
  }
  return { label: normalized, offset: 0 }
}

function MatchText({ text, indices = [] }: { text: string; indices?: number[] }) {
  const { tokens: { colors } } = useMobileTheme()
  const matching = new Set(indices)
  const runs: { value: string; matched: boolean }[] = []
  let offset = 0
  for (const char of text) {
    const matched = matching.has(offset)
    const previous = runs.at(-1)
    if (previous?.matched === matched) previous.value += char
    else runs.push({ value: char, matched })
    offset += char.length
  }
  return <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: '500' }}>
    {runs.map((run, index) => <Text key={index} style={run.matched ? { color: colors.primary, fontWeight: '700' } : undefined}>{run.value}</Text>)}
  </Text>
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
  const { t } = useMobileLocale()
  const goto = props.finder.kind === 'goto' ? props.finder : null
  const search = props.finder.kind === 'search' ? props.finder : null
  const Glyph = goto ? TextCursorInput : Search

  return (
    <View style={styles.flex}>
      {/* No close button: the header's trailing control is the way out, so a
          second control claiming the same state would only be a way for the
          two to disagree. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10,
          borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Glyph size={15} color={colors.mutedForeground} />
          <TextInput
            accessibilityLabel={goto ? t('Folder path') : t('Search files')}
            autoFocus
            value={props.query}
            onChangeText={props.onQuery}
            placeholder={goto ? '/path/to/folder' : t('Search files')}
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
            <Text style={styles.emptyBody}>{props.busy ? t('Reading folder…') : t('No matching folders')}</Text>
          </View>}
          keyExtractor={(item) => item.name}
          renderItem={({ item }) => <ListRow
            title={item.name}
            leading={<Folder size={19} color={colors.mutedForeground} />}
            onPress={() => goto.onComplete(item.name)}
          />}
        />
      ) : search ? (
        !search.results.length && props.query.trim() ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyBody}>
              {search.searched ? t('No matching files') : t('Searching…')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={search.results}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 6 }}
            keyExtractor={(item) => item.path}
            renderItem={({ item }) => {
              const { label, offset } = searchResultLabel(item.path, search.root)
              const target = resolveRemoteFilePath(search.root, item.path)
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => item.isDirectory ? search.onOpenDirectory(target) : search.onOpenFile(target)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    borderRadius: 6,
                    backgroundColor: pressed ? colors.muted : 'transparent',
                  })}
                >
                  <FileTypeIcon name={label} directory={item.isDirectory} size={16} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <MatchText text={label} indices={shiftIndices(item.matchIndices, offset, label.length)} />
                  </View>
                </Pressable>
              )
            }}
          />
        )
      ) : null}
    </View>
  )
}
