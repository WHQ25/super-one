import type { ReactNode } from 'react'
import Animated from 'react-native-reanimated'
import { Text } from './text'
import type { ProjectSessions } from '../navigation/use-project-sessions'
import type { SessionListItem, SessionListRow } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { SessionRowContent } from './session-row-content'
import { sessionListLayout, sessionRowEntering, sessionRowExiting } from './session-unfold-motion'
import { SwipeSessionRow } from './swipe-session-row'
import { useIconMotion } from './use-icon-motion'
import { useMobileLocale } from '../i18n/context'
import { SESSION_CHILD_LIST_MAX_HEIGHT, VirtualSessionList } from './virtual-session-list'

/**
 * The three list commands resolve `true` only once the host confirmed them, so
 * this component can apply the change locally instead of refetching every page —
 * and leave the row untouched when the command failed. Reporting the failure
 * itself belongs to the shell, which owns the status line.
 */
export type SessionListActions = {
  onOpenSession: (session: SessionListRow) => void
  onPinSession: (session: SessionListRow, pinned: boolean) => Promise<boolean>
  onSettleSession: (session: SessionListRow, settled: boolean) => Promise<boolean>
  onDeleteSession: (session: SessionListRow) => Promise<boolean>
}

/**
 * One project's session rows. Expanded, they scroll in their own capped list
 * and load the next page near the bottom. A collapsed project keeps its
 * attention rows in the outer scroller.
 */
export function SessionListBody(props: SessionListActions & {
  sessions: ProjectSessions
  activeSessionId?: string | null
  /** Which neutral this list sits on; rows pick their fills from it. */
  surface?: 'panel' | 'page'
  /**
   * A collapsed project only paints live, unseen, pending, and the active
   * session, the way the desktop sidebar does. Empty copy belongs to the
   * expanded list; the first read's spinner belongs to the project row above,
   * where it cannot shift the rows.
   */
  collapsed?: boolean
  /**
   * Play the unfold. The owner turns this off for an expansion the user did
   * not tap — the drawer opening onto the active project — so the rows land
   * in place instead of sliding in on every open.
   */
  animate?: boolean
}) {
  const { tokens: { colors } } = useMobileTheme()
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

    {collapsed ? sessions.items.map((item, index) => <Animated.View
      key={item.session.sessionId}
      entering={motion ? sessionRowEntering(index) : undefined}
      exiting={motion ? sessionRowExiting : undefined}
    >
      {sessionRow(props, sessions, item, applyIfConfirmed)}
    </Animated.View>) : sessions.items.length > 0 ? <SessionScroller
      testID="active-session-list"
      slots={sessionListSlots(sessions.items)}
      sessions={sessions}
      motion={motion}
      renderRow={(item) => sessionRow(props, sessions, item, applyIfConfirmed)}
    /> : null}
  </Animated.View>
}

type SessionSlot =
  | { kind: 'row'; key: string; item: SessionListItem }
  | { kind: 'children'; key: string; parentId: string; items: SessionListItem[] }

/**
 * An expanded parent's children become one slot: their own short scroller.
 * A collapsed parent keeps its attention children as ordinary rows.
 */
export function sessionListSlots(items: SessionListItem[]): SessionSlot[] {
  const slots: SessionSlot[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]!
    slots.push({ kind: 'row', key: item.session.sessionId, item })
    index += 1
    if (item.child || !item.hasChildren || item.collapsed) continue
    const children: SessionListItem[] = []
    while (index < items.length && items[index]?.child) {
      children.push(items[index]!)
      index += 1
    }
    if (children.length > 0) {
      slots.push({ kind: 'children', key: `children:${item.session.sessionId}`, parentId: item.session.sessionId, items: children })
    }
  }
  return slots
}

function SessionScroller(props: {
  testID: string
  slots: SessionSlot[]
  sessions: ProjectSessions
  motion: boolean
  /** Child lists are shorter than the project list, matching desktop `max-h-36`. */
  maxHeight?: number
  renderRow: (item: SessionListItem) => ReactNode
}) {
  return <VirtualSessionList
    testID={props.testID}
    maxHeight={props.maxHeight}
    count={props.slots.length}
    getKey={(index) => props.slots[index]?.key ?? index}
    hasMore={props.sessions.hasMore}
    loadToken={props.sessions.loadedCount}
    loadingMore={props.sessions.loadingMore}
    onLoadMore={props.sessions.loadMore}
    animate={props.motion}
    renderItem={(index) => {
      const slot = props.slots[index]
      if (!slot) return null
      if (slot.kind === 'row') return props.renderRow(slot.item)
      return <SessionScroller
        testID={`child-session-list-${slot.parentId}`}
        slots={slot.items.map((item) => ({ kind: 'row', key: item.session.sessionId, item }))}
        sessions={props.sessions}
        motion={props.motion}
        maxHeight={SESSION_CHILD_LIST_MAX_HEIGHT}
        renderRow={props.renderRow}
      />
    }}
  />
}

function sessionRow(
  props: SessionListActions & { surface?: 'panel' | 'page'; activeSessionId?: string | null },
  sessions: ProjectSessions,
  item: SessionListItem,
  applyIfConfirmed: (op: Promise<boolean>, apply: () => void) => void,
) {
  return <SwipeSessionRow
    sessionId={item.session.sessionId}
    title={item.session.title}
    pinned={item.session.isPinned}
    onPress={() => props.onOpenSession(item.session)}
    onPin={() => applyIfConfirmed(
      props.onPinSession(item.session, !item.session.isPinned),
      () => sessions.patch(item.session.sessionId, { isPinned: !item.session.isPinned }),
    )}
    onSettle={() => applyIfConfirmed(
      props.onSettleSession(item.session, true),
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
}
