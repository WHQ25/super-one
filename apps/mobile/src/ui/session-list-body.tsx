import { ActivityIndicator, Pressable } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import Animated from 'react-native-reanimated'
import { Text } from './text'
import type { ProjectSessions } from '../navigation/use-project-sessions'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { SessionRowContent } from './session-row-content'
import { sessionListLayout, sessionRowEntering, sessionRowExiting } from './session-unfold-motion'
import { SwipeSessionRow } from './swipe-session-row'
import { useIconMotion } from './use-icon-motion'
import { useMobileLocale } from '../i18n/context'

/**
 * The three list commands resolve `true` only once the host confirmed them, so
 * this component can apply the change locally instead of refetching every page —
 * and leave the row untouched when the command failed. Reporting the failure
 * itself belongs to the shell, which owns the status line.
 */
export type SessionListActions = {
  onOpenSession: (session: SessionListRow) => void
  onPinSession: (session: SessionListRow, pinned: boolean) => Promise<boolean>
  onArchiveSession: (session: SessionListRow) => Promise<boolean>
  onDeleteSession: (session: SessionListRow) => Promise<boolean>
}

/**
 * One project's session rows and its load-more footer, without a scroll
 * container: the drawer nests this inside the ScrollView that also holds the
 * project rows, while the tablet sidebar gives it one of its own.
 */
export function SessionListBody(props: SessionListActions & {
  sessions: ProjectSessions
  activeSessionId?: string | null
  /** Which neutral this list sits on; rows pick their fills from it. */
  surface?: 'panel' | 'page'
  /**
   * A collapsed project only paints live, unseen, pending, and the active
   * session, the way the desktop sidebar does. Empty copy and "Show more"
   * belong to the expanded list; the first read's spinner belongs to the
   * project row above, where it cannot shift the rows.
   */
  collapsed?: boolean
  /**
   * Play the unfold. The owner turns this off for an expansion the user did
   * not tap — the drawer opening onto the active project — so the rows land
   * in place instead of sliding in on every open.
   */
  animate?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const motion = useIconMotion() && props.animate !== false
  const { sessions, collapsed } = props
  const applyIfConfirmed = (op: Promise<boolean>, apply: () => void) => {
    void op.then((confirmed) => { if (confirmed) apply() })
  }
  return <Animated.View
    style={{ overflow: 'hidden' }}
    layout={motion ? sessionListLayout(!!collapsed) : undefined}
  >
    {!collapsed && sessions.error ? <Text style={{ color: colors.error, padding: 12 }}>{sessions.error}</Text> : null}
    {/* `!loaded` covers the frame before the request is even in flight; without
        it the empty state flashes on every first paint. */}
    {!collapsed && sessions.loaded && !sessions.busy && !sessions.error && !sessions.items.length
      ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>{t('No sessions yet')}</Text>
      : null}

    {sessions.items.map((item, index) => <Animated.View
      key={item.session.sessionId}
      entering={motion ? sessionRowEntering(index) : undefined}
      exiting={motion ? sessionRowExiting : undefined}
    >
      <SwipeSessionRow
        title={item.session.title}
        pinned={item.session.isPinned}
        onPress={() => props.onOpenSession(item.session)}
        onPin={() => applyIfConfirmed(
          props.onPinSession(item.session, !item.session.isPinned),
          () => sessions.patch(item.session.sessionId, { isPinned: !item.session.isPinned }),
        )}
        onArchive={() => applyIfConfirmed(
          props.onArchiveSession(item.session),
          () => sessions.forget(item.session.sessionId),
        )}
        onDelete={() => applyIfConfirmed(
          props.onDeleteSession(item.session),
          () => sessions.forget(item.session.sessionId),
        )}
      >
        {({ revealed }) => <SessionRowContent
          item={item}
          surface={props.surface}
          revealed={revealed}
          selected={item.session.sessionId === props.activeSessionId}
          onToggleChildren={() => sessions.toggleChildren(item.session.sessionId)}
        />}
      </SwipeSessionRow>
    </Animated.View>)}

    {/* The desktop sidebar's footer: chevron + small muted label, a quiet
        control rather than a link. Only the pressed fill differs — hover
        has no phone equivalent. */}
    {!collapsed && sessions.hasMore ? (sessions.loadingMore
      ? <ActivityIndicator style={{ padding: 12 }} color={colors.mutedForeground} />
      : <Pressable accessibilityRole="button" accessibilityLabel={t('Show more sessions')} onPress={sessions.loadMore}
          style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
            minHeight: 32, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: pressed ? colors.muted : 'transparent' })}>
          <ChevronDown size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '500' }}>{t('Show more')}</Text>
        </Pressable>
    ) : null}
  </Animated.View>
}
