import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Search, SearchX } from 'lucide-react-native'
import { Text } from '../ui/text'
import type { RelayClient } from '@superone/relay-client'
import type { SessionListRow } from '../session-list-state'
import { searchSessions } from '../navigation/workspace-data'
import { useMobileTheme } from '../theme/context'
import { SessionRowContent } from '../ui/session-row-content'
import { useMobileLocale } from '../i18n/context'

/** Long enough that a fast typist sends one request, short enough to feel live. */
const DEBOUNCE_MS = 220

/**
 * Global session search. The host does the matching across every project, so
 * this never has to page a project list into memory to answer; results carry
 * the project they belong to, which is also how the caller opens them.
 */
export function SessionSearchScreen(props: {
  client: RelayClient | null
  onOpenSession: (session: SessionListRow) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionListRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const trimmed = query.trim()

  useEffect(() => {
    const request = ++generation.current
    if (!trimmed || !props.client) {
      setResults([])
      setBusy(false)
      setError('')
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      searchSessions(props.client!, trimmed)
        .then((rows) => { if (request === generation.current) { setResults(rows); setError('') } })
        .catch((cause: unknown) => {
          if (request !== generation.current) return
          setResults([])
          setError(cause instanceof Error ? cause.message : 'Search failed')
        })
        .finally(() => { if (request === generation.current) setBusy(false) })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); generation.current++ }
  }, [trimmed, props.client])

  return <SessionSearchView
    query={query}
    onQuery={setQuery}
    busy={busy}
    error={error}
    results={results}
    autoFocus
    onOpenSession={props.onOpenSession}
    onCancel={props.onCancel}
  />
}

/**
 * Search field + results. Split from the host fetch so stories can pin every
 * visible state without a live desktop or the debounce.
 */
export function SessionSearchView(props: {
  query: string
  onQuery: (value: string) => void
  busy: boolean
  error: string
  results: SessionListRow[]
  /** Live route focuses the field; stories and tests leave it alone. */
  autoFocus?: boolean
  onOpenSession: (session: SessionListRow) => void
  onCancel: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const dim = colors.mutedForeground
  const trimmed = props.query.trim()
  const items = useMemo(
    () => props.results.map((session) => ({ session, child: false, hasChildren: false, collapsed: false })),
    [props.results],
  )

  // The field IS the screen: no header, because a title bar over a search box
  // that already says what it does would cost a third of the results. The
  // shell's root SafeAreaView already clears the notch — padding it here a
  // second time dropped the field a full status-bar height.
  return <View testID="session-search-screen" style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.muted }}>
        <Search size={16} color={dim} />
        <TextInput value={props.query} onChangeText={props.onQuery} accessibilityLabel={t('Search sessions')}
          placeholder={t('Search all sessions…')} placeholderTextColor={dim}
          autoCapitalize="none" autoCorrect={false} autoFocus={props.autoFocus} returnKeyType="search"
          style={{ flex: 1, minHeight: 44, fontSize: 15, color: colors.foreground }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel search')} onPress={props.onCancel}
        style={({ pressed }) => ({ paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ color: colors.primary, fontSize: 15 }}>{t('Cancel')}</Text>
      </Pressable>
    </View>
    {props.busy ? <ActivityIndicator style={{ padding: 16 }} color={dim} /> : null}
    {props.error ? <Text style={{ color: colors.error, padding: 16 }}>{props.error}</Text> : null}
    {!props.busy && !props.error && trimmed && !items.length ? (
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 48 }}>
        <SearchX color={colors.border} size={48} />
        <Text style={{ color: dim }}>{localeSessionMatch(t, trimmed)}</Text>
      </View>
    ) : null}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}>
      {items.map((item) => (
        <Pressable key={item.session.sessionId} accessibilityRole="button"
          onPress={() => props.onOpenSession(item.session)}
          style={({ pressed }) => ({ borderRadius: radius.md, opacity: pressed ? 0.7 : 1 })}>
          <SessionRowContent item={item} surface="page" subtitle={item.session.projectName} />
        </Pressable>
      ))}
    </ScrollView>
  </View>
}

function localeSessionMatch(t: (source: string) => string, query: string): string {
  return t('No sessions matched “{{query}}”').replace('{{query}}', query)
}
