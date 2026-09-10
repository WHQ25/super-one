import { sessionActivityIconStatus } from '../session-activity-state'
import { useSessionActivity } from '../navigation/use-session-activity'
import { useMobileLocale } from '../i18n/context'
import { Bot, ChevronDown, ChevronRight, CornerDownRight, MessageSquare } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import type { SessionListItem } from '../session-list-state'
import { useMobileTheme } from '../theme/context'
import { AnimatedSessionTitle } from './animated-session-title'
import { HarnessIcon, sessionIconState } from './harness-icon'

/**
 * One session row: icon, title, and — on a collaboration parent — the expand
 * toggle. Deliberately single-line and free of model/branch/tag detail, matching
 * the desktop sidebar.
 *
 * Icon chrome matches desktop too: the cross-project Pinned section (`branded`)
 * always shows the larger harness mark (`PinnedSessionRow`). The project list
 * uses a message glyph when idle — even if the same session is pinned above —
 * and only swaps to the harness mark for running / background / unseen /
 * automation.
 *
 * A child carries no extra padding either: like the desktop sidebar, the corner
 * arrow is the whole nesting cue, and it already shifts the row by its own width.
 */
export function SessionRowContent({ item, selected, revealed, subtitle, surface = 'panel', branded, onToggleChildren }: {
  item: SessionListItem
  selected?: boolean
  /**
   * Which neutral the list sits on. A swiped row slides across its actions, so
   * it has to be opaque; it swaps to the *other* neutral while it does, which is
   * also what marks it as the row being handled.
   */
  surface?: 'panel' | 'page'
  /**
   * Swipe actions are showing.
   */
  revealed?: boolean
  /** Second line for cross-project lists (pinned, search): which project it is in. */
  subtitle?: string
  /**
   * Cross-project Pinned section: always the harness brand, like desktop
   * `PinnedSessionRow`. Project lists omit this and follow session-list rules.
   */
  branded?: boolean
  onToggleChildren?: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const activity = useSessionActivity(item.session.sessionId)
  const { locale } = useMobileLocale()
  const session = { ...item.session, ...activity }
  const iconStatus = sessionActivityIconStatus(session)
  const pendingReason = activity?.pendingReason?.[locale]
  const Chevron = item.collapsed ? ChevronRight : ChevronDown
  const onPanel = surface === 'panel'
  const ink = colors.foreground
  const dim = colors.mutedForeground
  const fill = revealed
    ? onPanel ? colors.background : colors.surface
    : selected ? colors.muted : onPanel ? colors.surface : colors.background
  return <View style={{ backgroundColor: fill, borderRadius: radius.md }}><View style={{
    flexDirection: 'row', alignItems: 'center', gap: 10,
    // A cross-project row carries a second line and sets its own height; a
    // single-line row is sized to the text plus a touchable margin, not to the
    // 44pt a standalone control would need.
    minHeight: subtitle ? 44 : 38,
    backgroundColor: fill,
    borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 12,
  }}>
    {item.child ? <CornerDownRight size={13} color={dim} /> : null}
    {branded || sessionIconState(iconStatus) !== 'default'
      ? <HarnessIcon provider={session.provider ?? 'claude'} acpAgentId={session.acpAgentId} status={iconStatus} size={branded ? 22 : 18} />
      : <View testID="session-list-icon" accessible={false} style={{ width: 18, height: 18 }}>
          <MessageSquare size={18} color={dim} />
        </View>}
    <View style={{ flex: 1, minWidth: 0 }}>
      <AnimatedSessionTitle key={session.sessionId} title={session.title || 'Untitled'} style={{ color: ink, fontSize: 15, fontWeight: selected ? '500' : '400' }} />
      {subtitle ? <Text numberOfLines={1} style={{ color: dim, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
    </View>
    {/* No pin glyph: the drawer carries a Pinned section of its own, so a badge
        on the row would state twice what the section above already says. */}
    {item.hasChildren && onToggleChildren ? <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.collapsed ? 'Show' : 'Hide'} sessions started by ${session.title || 'Untitled'}`}
      accessibilityState={{ expanded: !item.collapsed }}
      hitSlop={10}
      onPress={onToggleChildren}
      style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
    >
      <Chevron size={15} color={dim} />
    </Pressable> : null}
  </View>
    {pendingReason ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
      marginLeft: item.child ? 35 : 12, marginRight: 4, marginTop: 2, marginBottom: 4,
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm,
      backgroundColor: `${colors.success}26`,
    }}>
      <Bot size={12} color={colors.success} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: colors.success }}>{pendingReason}</Text>
    </View> : null}
  </View>
}
