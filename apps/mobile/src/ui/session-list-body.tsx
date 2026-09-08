import { ActivityIndicator, View } from 'react-native'
import { Text } from './text'
import type { ProjectSessions } from '../navigation/use-project-sessions'
import type { SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { SessionRowContent } from './session-row-content'
import { SwipeSessionRow } from './swipe-session-row'
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
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { sessions } = props
  const applyIfConfirmed = (op: Promise<boolean>, apply: () => void) => {
    void op.then((confirmed) => { if (confirmed) apply() })
  }
  return <View>
    {/* `!loaded` covers the frame before the request is even in flight; without
        it the empty state flashes on every first paint. */}
    {sessions.busy || !sessions.loaded ? <ActivityIndicator style={{ padding: 12 }} color={colors.mutedForeground} /> : null}
    {sessions.error ? <Text style={{ color: colors.error, padding: 12 }}>{sessions.error}</Text> : null}
    {sessions.loaded && !sessions.busy && !sessions.error && !sessions.items.length
      ? <Text style={{ color: colors.mutedForeground, fontSize: 13, padding: 12 }}>{t('No sessions yet')}</Text>
      : null}

    {sessions.items.map((item) => <SwipeSessionRow
      key={item.session.sessionId}
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
    </SwipeSessionRow>)}

    {sessions.hasMore ? (sessions.loadingMore
      ? <ActivityIndicator style={{ padding: 12 }} color={colors.mutedForeground} />
      : <Text accessibilityRole="button" accessibilityLabel={t('Show more sessions')} onPress={sessions.loadMore}
          style={{ color: colors.primary, fontSize: 13, paddingVertical: 12, paddingHorizontal: 12 }}>
          {t('Show more')}
        </Text>
    ) : null}
  </View>
}
