import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Bot, CheckCircle2, ChevronRight, Circle, CircleDashed, ListTodo, Lock } from 'lucide-react-native'
import type { TodoItem } from '@superone/shared/agent-types'
import { buildTodoPanelRows, todoPanelSummary, type TodoPanelRow } from '../todo-panel-state'
import { shouldUseTabletComposer } from '../layout-state'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { CHIP_HEIGHT } from './chip-metrics'
import { RotatingChevron } from './rotating-chevron'
import { SpinningIcon } from './spinning-icon'
import { useIconMotion } from './use-icon-motion'
import { Text } from './text'

/**
 * The list is a strip above the composer, not a page: past four or five rows it
 * scrolls instead of pushing the input off screen. Desktop and Flutter both cap
 * it at the same height.
 */
const LIST_MAX_HEIGHT = 140
/** Slow enough to read as a state marker rather than a request in flight. */
const RUNNING_SPIN_MS = 3_000
const PULSE_MS = 1_500

/**
 * The session's todo list, above the composer — the one place it is shown.
 *
 * Phone chrome follows Flutter: a full-bleed strip hairlined off the transcript
 * and the composer. Tablet chrome follows desktop: an inset rounded card, which
 * only works once there is width to spare on either side.
 */
export function TodoPanel(props: {
  todos: Record<string, TodoItem>
  /** Pin the chrome for stories and tests; width and height decide otherwise. */
  tablet?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { width, height } = useWindowDimensions()
  const tablet = props.tablet ?? shouldUseTabletComposer(width, height)
  const [expanded, setExpanded] = useState(false)
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set())
  const listRef = useRef<ScrollView>(null)

  const rows = buildTodoPanelRows(props.todos)
  const { completed, total, hasInProgress } = todoPanelSummary(rows)
  // Keep the running row in view as the agent walks the list; the strip is far
  // too short to hold a long plan, so without this it scrolls out from under you.
  // Every row reports its offset, not just the running one: handing `onLayout` to
  // a row that is already laid out does not re-fire it, so a status change would
  // otherwise scroll to wherever the *previous* active row sat.
  const offsets = useRef(new Map<string, number>()).current
  const activeId = rows.find((row) => row.status === 'in_progress')?.id
  useEffect(() => {
    if (!expanded || !activeId) return
    const y = offsets.get(activeId)
    if (y === undefined) return
    listRef.current?.scrollTo({ y: Math.max(0, y - LIST_MAX_HEIGHT / 2), animated: true })
  }, [activeId, expanded, offsets])

  if (rows.length === 0) return null

  const toggleRow = (id: string) => setOpenRows((previous) => {
    const next = new Set(previous)
    if (!next.delete(id)) next.add(id)
    return next
  })

  return (
    <View
      testID="todo-panel"
      // No fill in either variant: the whole chat column — header, transcript,
      // this strip, the input — is one background, and every boundary in it is a
      // border. Desktop's `TodoPopup` and `ChatInput` both do exactly this.
      style={tablet
        ? {
          marginHorizontal: 12,
          marginBottom: 4,
          // 1, not hairline: this card sits directly above the composer card and
          // the two are read as a pair. At hairline it is half the composer's
          // weight on a 2x screen and the pair looks misaligned.
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
          overflow: 'hidden',
        }
        : {
          // Rules on both edges, same fill: the strip is bounded off the
          // transcript above and the status chips below without becoming its
          // own colour band. Flutter's borders were right; only its fill was.
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.background,
        }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${t('Todos')} (${completed}/${total})`}
        onPress={() => setExpanded((open) => !open)}
        // Same line height as the status chips below it; see `CHIP_HEIGHT`.
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: CHIP_HEIGHT }}
      >
        {/* Collapsed with work in flight is the one state worth a moving
            element: the strip is otherwise indistinguishable from a finished list.
            The glyph carries it rather than the count — desktop breathes the text,
            but on a phone that reads as the number itself being unreliable. */}
        <Pulse active={!expanded && hasInProgress}>
          <ListTodo size={14} color={colors.mutedForeground} />
        </Pulse>
        <Text style={{ fontSize: 12, fontWeight: '500', color: colors.mutedForeground }}>
          {t('Todos')} ({completed}/{total})
        </Text>
      </Pressable>
      {expanded ? (
        <ScrollView
          ref={listRef}
          style={{ maxHeight: LIST_MAX_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
          contentContainerStyle={{ padding: 4 }}
          keyboardShouldPersistTaps="handled"
        >
          {rows.map((row) => (
            <TodoRow
              key={row.id}
              row={row}
              open={openRows.has(row.id)}
              onToggle={() => toggleRow(row.id)}
              onLayout={(y) => offsets.set(row.id, y)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

function TodoRow(props: {
  row: TodoPanelRow
  open: boolean
  onToggle: () => void
  onLayout: (y: number) => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { row } = props
  const done = row.status === 'completed'
  const running = row.status === 'in_progress'
  const text = {
    fontSize: 12,
    lineHeight: 16,
    color: done ? colors.mutedForeground : colors.foreground,
    textDecorationLine: done ? ('line-through' as const) : ('none' as const),
  }
  return (
    <View onLayout={(event) => props.onLayout(event.nativeEvent.layout.y)}>
      <Pressable
        accessibilityRole={row.expandable ? 'button' : undefined}
        accessibilityState={row.expandable ? { expanded: props.open } : undefined}
        disabled={!row.expandable}
        onPress={props.onToggle}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 8, paddingVertical: 4 }}
      >
        <View style={{ marginTop: 2 }}>
          {done ? <CheckCircle2 size={14} color={colors.success} />
            : running ? <SpinningIcon icon={CircleDashed} size={14} color={colors.primary} durationMs={RUNNING_SPIN_MS} />
              : <Circle size={14} color={colors.mutedForeground} />}
        </View>
        {/* Owner and blockers are siblings rather than nested in the sentence:
            RN can host a View inside a Text, but an SVG there measures wrong on
            Android. Wrapping puts them beside short rows and under long ones. */}
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Text style={[text, { flexShrink: 1 }]}>
            <Text style={[text, { color: colors.mutedForeground, textDecorationLine: 'none' }]}>#{row.id} </Text>
            {row.text}
          </Text>
          {row.owner ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 130 }}>
              <Bot size={12} color={colors.mutedForeground} />
              <Text numberOfLines={1} style={{ fontSize: 11, color: colors.mutedForeground, flexShrink: 1 }}>{row.owner}</Text>
            </View>
          ) : null}
          {row.blockers.length ? (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              borderRadius: 999,
              paddingHorizontal: 6,
              paddingVertical: 1,
              backgroundColor: `${colors.warning}26`,
            }}>
              <Lock size={10} color={colors.warning} />
              <Text style={{ fontSize: 10, fontWeight: '500', color: colors.warning }}>
                {row.blockers.map((blocker) => `#${blocker}`).join(' ')}
              </Text>
            </View>
          ) : null}
        </View>
        {row.expandable
          ? <RotatingChevron open={props.open} icon={ChevronRight} degrees={90} size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
          : null}
      </Pressable>
      {row.description && (row.autoDescription || props.open) ? (
        <View style={{
          marginLeft: 26,
          marginBottom: 4,
          paddingHorizontal: 8,
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderLeftColor: colors.border,
        }}>
          <Text style={{ fontSize: 11, lineHeight: 16, color: colors.mutedForeground }}>{row.description}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** Opacity breathing on the same motion gate the harness icons use. */
function Pulse(props: { active: boolean; children: ReactNode }) {
  const animate = useIconMotion()
  const opacity = useRef(new Animated.Value(1)).current
  const running = props.active && animate
  useEffect(() => {
    if (!running) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.4, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => {
      loop.stop()
      opacity.setValue(1)
    }
  }, [opacity, running])
  return <Animated.View style={{ opacity }}>{props.children}</Animated.View>
}
