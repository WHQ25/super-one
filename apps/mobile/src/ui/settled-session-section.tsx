import { ActivityIndicator, Pressable, View } from 'react-native'
import { ChevronDown, CircleCheck } from 'lucide-react-native'
import { Text } from './text'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { SessionRowContent } from './session-row-content'
import { SwipeSessionRow } from './swipe-session-row'
import { VirtualSessionList } from './virtual-session-list'

/**
 * Finished sessions under one expanded project. Absent when the project has
 * none, so the group does not ask for attention. Folded until opened; the
 * count is the project's total, not just the page already loaded.
 */
export function SettledSessionSection(props: {
  rows: SessionListRow[]
  total: number
  open: boolean
  onToggle: () => void
  busy?: boolean
  loadingMore?: boolean
  error?: string
  hasMore?: boolean
  onLoadMore?: () => void
  activeSessionId?: string | null
  surface?: 'panel' | 'page'
  onOpenSession: (session: SessionListRow) => void
  onSettleSession: (session: SessionListRow) => void
  onDeleteSession: (session: SessionListRow) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  if (!props.error && props.total <= 0 && props.rows.length === 0) return null
  const label = props.open || props.total <= 0 ? t('Settled') : `${t('Settled')}, ${props.total}`
  return <View testID="settled-session-section" style={{ paddingTop: 2 }}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: props.open }}
      accessibilityLabel={label}
      onPress={props.onToggle}
      style={({ pressed }) => ({
        minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
        borderRadius: radius.md, backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      {props.open
        ? <ChevronDown size={14} color={colors.mutedForeground} />
        : <CircleCheck size={14} color={colors.mutedForeground} />}
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '500' }}>{t('Settled')}</Text>
      {!props.open && props.total > 0 ? <Text style={{ marginLeft: 'auto', color: colors.mutedForeground, fontSize: 11, fontVariant: ['tabular-nums'] }}>{props.total}</Text> : null}
    </Pressable>
    {props.error ? <Text style={{ color: colors.error, paddingHorizontal: 12, paddingBottom: 8, fontSize: 13 }}>{props.error}</Text> : null}
    {props.open && props.rows.length > 0 ? <VirtualSessionList
      testID="settled-session-list"
      count={props.rows.length}
      getKey={(index) => props.rows[index]?.sessionId ?? index}
      hasMore={props.hasMore}
      loadingMore={props.loadingMore}
      onLoadMore={props.onLoadMore}
      renderItem={(index) => {
        const session = props.rows[index]
        if (!session) return null
        return <SwipeSessionRow
          sessionId={session.sessionId}
          title={session.title}
          settled
          onPress={() => props.onOpenSession(session)}
          onPin={() => {}}
          onSettle={() => props.onSettleSession(session)}
          onDelete={() => props.onDeleteSession(session)}
        >
          {({ revealed }) => <SessionRowContent
            item={{ session, child: false, hasChildren: false, collapsed: false }}
            surface={props.surface}
            revealed={revealed}
            selected={session.sessionId === props.activeSessionId}
          />}
        </SwipeSessionRow>
      }}
    /> : null}
    {props.open && props.busy && props.rows.length === 0 ? <ActivityIndicator style={{ padding: 12 }} color={colors.mutedForeground} /> : null}
  </View>
}
