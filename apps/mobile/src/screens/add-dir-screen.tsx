import { ScrollView, View } from 'react-native'
import { Folder, X } from 'lucide-react-native'
import { ADD_DIR_TEXT, browseSections, type AddDirScope, type AddDirStep } from '../add-dir-state'
import { Text } from '../ui/text'
import { Button } from '../ui/primitives'
import { IconButton } from '../ui/icon-button'
import { BrowsePage } from '../ui/browse-page'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import { useMobileTheme } from '../theme/context'

export type AddDirScreenProps = {
  step: AddDirStep
  /** Folders the project carries; every session in it inherits them. */
  projectDirs: string[]
  /** Folders this session added on top, which end with it. */
  sessionDirs: string[]
  /** The host's listing of the directory the query points at. */
  entries: ReadonlyArray<{ name: string; path: string }>
  query: string
  loading: boolean
  busy: boolean
  error: string
  onQuery: (value: string) => void
  onEnter: (name: string) => void
  onBrowse: (scope: AddDirScope) => void
  onRemove: (dir: string, scope: AddDirScope) => void
}

/**
 * The folders the agent sees beyond the project root.
 *
 * Two steps. The overview says what the session already has and offers the one
 * decision that is actually a decision — which scope the next folder joins —
 * and picking it opens Add Project's local-folder browser, unchanged. Committing
 * is the header's confirm, where every other page puts it.
 *
 * Reusing that browser is the point: the field there *is* the path, so a typed
 * path, a tapped row and a pasted absolute path are one gesture. The version
 * this replaced had breadcrumbs, its own search box and `..` buttons, which was
 * three worse ways of saying it.
 */
export function AddDirScreen(props: AddDirScreenProps) {
  if (props.step.kind === 'browse') {
    return <BrowsePage
      query={props.query}
      onQuery={props.onQuery}
      placeholder={ADD_DIR_TEXT.placeholder}
      monospace
      sections={browseSections(props.entries, props.query)}
      onActivate={(row) => props.onEnter(row.key)}
      loading={props.loading}
      loadingLabel={ADD_DIR_TEXT.loading}
      emptyMessage={!props.loading && !props.entries.length ? ADD_DIR_TEXT.noDirectories : null}
      busy={props.busy}
      busyLabel={ADD_DIR_TEXT.adding}
      error={props.error}
    />
  }
  return <Overview {...props} />
}

function Overview({ projectDirs, sessionDirs, busy, error, onBrowse, onRemove }: AddDirScreenProps) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  return <View style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
      contentContainerStyle={{ paddingRight: SCROLL_INDICATOR_GUTTER, paddingBottom: spacing.md }}>
      <Group label={ADD_DIR_TEXT.project.toUpperCase()} scope="project" dirs={projectDirs}
        busy={busy} onRemove={onRemove} />
      <Group label={ADD_DIR_TEXT.session.toUpperCase()} scope="session" dirs={sessionDirs}
        busy={busy} onRemove={onRemove} />
    </ScrollView>
    {error ? (
      <Text accessibilityRole="alert" style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12,
        borderTopWidth: 1, borderTopColor: colors.border, color: colors.destructive }}>{error}</Text>
    ) : null}
    {/* Two buttons, not two list rows: picking a scope is the action this page
        exists for, and it should not be something to scroll past. Session takes
        the accent because it is the one being reached for — a folder wanted for
        the conversation in progress. Project is the deliberate, durable choice. */}
    <View style={{ flexDirection: 'row', gap: 10, padding: 12,
      borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flex: 1 }}>
        <Button label={ADD_DIR_TEXT.addToProject} variant="secondary" disabled={busy}
          onPress={() => onBrowse('project')} />
      </View>
      <View style={{ flex: 1 }}>
        <Button label={ADD_DIR_TEXT.addToSession} disabled={busy} onPress={() => onBrowse('session')} />
      </View>
    </View>
  </View>
}

function Group({ label, scope, dirs, busy, onRemove }: {
  label: string
  scope: AddDirScope
  dirs: string[]
  busy: boolean
  onRemove: (dir: string, scope: AddDirScope) => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  return <View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 12, fontWeight: '500', color: colors.mutedForeground }}>
        {label}
      </Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, opacity: 0.6 }}>· {dirs.length}</Text>
    </View>
    {dirs.length
      ? dirs.map((dir) => <DirRow key={dir} dir={dir} scope={scope} busy={busy}
        onRemove={() => onRemove(dir, scope)} />)
      // An empty scope is a fact about it, not a failure — the desktop popup
      // says `none` here rather than explaining itself twice.
      : <Text style={{ paddingHorizontal: 12, paddingVertical: 6, color: colors.mutedForeground,
        fontSize: 13, fontStyle: 'italic', opacity: 0.6 }}>none</Text>}
  </View>
}

function DirRow({ dir, scope, busy, onRemove }: {
  dir: string
  scope: AddDirScope
  busy: boolean
  onRemove: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12,
    paddingRight: 4, minHeight: 44 }}>
    <View style={{ width: 32, alignItems: 'center' }}>
      <Folder size={16} color={colors.mutedForeground} />
    </View>
    {/* The full path is what tells two folders of the same name apart, so it is
        the line that matters; the name leads because it is what is scanned. */}
    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 14, fontFamily: 'Menlo',
      color: colors.foreground }}>{dir}</Text>
    <IconButton icon={X} label={`Remove ${dir} from ${scope}`} chrome="plain" iconSize={16} disabled={busy}
      style={{ width: 40, height: 40 }} hitSlop={6} onPress={onRemove} />
  </View>
}
