import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native'
import { Search } from 'lucide-react-native'
import { Text } from './text'
import { AddProjectList } from './add-project-list'
import type { AddProjectRow, AddProjectSectionModel } from '../add-project-state'
import { SCROLL_INDICATOR_GUTTER } from './scroll-gutter'
import { useMobileTheme } from '../theme/context'

export type BrowsePageProps = {
  /** The whole path, typed or built by tapping rows. */
  query: string
  onQuery: (value: string) => void
  /** Null on a step that is a pure pick — the field is dropped entirely. */
  placeholder: string | null
  /** Monospace while the field holds a path rather than a search term. */
  monospace?: boolean
  sections: AddProjectSectionModel[]
  onActivate: (row: AddProjectRow) => void
  loading: boolean
  loadingLabel: string
  /** Shown in place of the list when there is nothing to list, and why. */
  emptyMessage?: string | null
  /** A write is in flight; the field stays readable but stops accepting input. */
  busy?: boolean
  busyLabel?: string
  error?: string
  /** Fixed content between the field and the list. */
  header?: ReactNode
}

/**
 * One field over a grouped list — the shape both Add Project and the
 * additional-folders page browse in.
 *
 * The field *is* the path. `path-browse.ts` splits it: everything up to the last
 * separator is the directory to list, what follows is a fuzzy filter over that
 * listing. So typing `~/Dev`, tapping rows, and pasting an absolute path are the
 * same gesture, and neither page needs breadcrumbs, a separate search box, or
 * `..` buttons to get anywhere.
 *
 * Committing is not here: both pages spend the header's confirm slot on it, so
 * the action sits where every other page's does rather than as a button the
 * list can push off-screen.
 *
 * A step with a null placeholder renders no field at all: on a phone an input
 * nobody should type into still raises the keyboard and eats a third of the
 * list, so a pure pick shows only its rows.
 */
export function BrowsePage(props: BrowsePageProps) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <View style={{ flex: 1 }}>
      {props.placeholder != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
          borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Search size={15} color={colors.mutedForeground} />
          <TextInput value={props.query} onChangeText={props.onQuery}
            accessibilityLabel={props.placeholder}
            placeholder={props.placeholder} placeholderTextColor={colors.mutedForeground}
            editable={!props.busy} autoCapitalize="none" autoCorrect={false} spellCheck={false}
            style={{ flex: 1, minHeight: 44, fontSize: 14, color: colors.foreground,
              fontFamily: props.monospace ? 'Menlo' : undefined }} />
        </View>
      ) : null}

      {props.header}

      {props.loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ActivityIndicator color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{props.loadingLabel}</Text>
        </View>
      ) : props.emptyMessage ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Text style={{ fontSize: 12, textAlign: 'center', color: colors.mutedForeground }}>
            {props.emptyMessage}
          </Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
          contentContainerStyle={{ paddingRight: SCROLL_INDICATOR_GUTTER, paddingBottom: 16 }}>
          <AddProjectList sections={props.sections} onActivate={props.onActivate} />
        </ScrollView>
      )}

      {props.busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
          paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{props.busyLabel ?? props.loadingLabel}</Text>
        </View>
      ) : null}
      {props.error ? (
        <Text accessibilityRole="alert" style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12,
          borderTopWidth: 1, borderTopColor: colors.border, color: colors.destructive }}>
          {props.error}
        </Text>
      ) : null}
    </View>
  )
}
