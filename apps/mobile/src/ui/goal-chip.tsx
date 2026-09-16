import { CircleCheckBig, Goal, Pause, Pencil, Play, Trash2, X, type LucideIcon } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from './text'
import type { SessionGoal, SessionGoalStatus } from '@superone/shared/agent-types'
import type { GoalCapability } from '@superone/shared/harness/harness-capabilities'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuSeparator, useMenuAnchor } from './anchored-menu'
import { CHIP_HEIGHT, CHIP_HIT_SLOP, chipTriggerBackground } from './chip-metrics'
import { planTone } from './permission-mode-data'
import { Pulse } from './pulse'
import { useMobileLocale } from '../i18n/context'

/**
 * About five lines of objective. Past that it scrolls: the actions below have to
 * stay on screen, and an objective long enough to push them off is exactly the
 * one worth reading in full.
 */
const OBJECTIVE_MAX_HEIGHT = 110

/** 44 pt of target under a 34 pt control, the way the composer chips do it. */
const ACTION_HIT_SLOP = { top: 5, bottom: 5, left: 0, right: 0 }

const STATUS_LABELS: Record<SessionGoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  usageLimited: 'Usage limited',
  budgetLimited: 'Budget limited',
  complete: 'Complete',
}

export type GoalChipProps = {
  /** `null` hides the chip — a session without a goal says nothing worth a glyph. */
  goal: SessionGoal | null
  capability: GoalCapability
  /** Put `/goal <objective>` back in the composer for the user to rewrite. */
  onEdit: () => void
  onClear: () => void
  onPause: () => void
  onResume: () => void
  /** Drop an achieved goal from the composer. Local only — the harness already cleared it. */
  onDismiss: () => void
}

/**
 * The session goal, as one glyph in the composer's readout group.
 *
 * Icon-only, unlike the desktop chip: this row is already spending its width on
 * a model name, and the objective is a sentence that no chip could carry. The
 * icon says which of two things is true — being pursued (`Goal`, breathing) or
 * met (`CircleCheckBig`, green) — and everything else is one tap away.
 *
 * Every tap opens the menu, including on an achieved goal. Desktop can put a
 * close mark under the pointer on hover; a phone has no hover, and a chip whose
 * single tap sometimes dismisses and sometimes opens would be a coin flip. So
 * dismissal is a row in the menu like every other action.
 *
 * Which actions exist follows the capability, never the harness id: Claude has
 * no pause lifecycle, so those rows are absent rather than disabled.
 */
export function GoalChip({ goal, capability, onEdit, onClear, onPause, onResume, onDismiss }: GoalChipProps) {
  const menu = useMenuAnchor()
  const { tokens } = useMobileTheme()
  const { colors } = tokens
  const { t } = useMobileLocale()
  if (!goal) return null
  const achieved = goal.status === 'complete'
  const tone = achieved ? colors.success : planTone(tokens.scheme) ?? colors.foreground
  const Icon = achieved ? CircleCheckBig : Goal
  return <>
    <Pressable ref={menu.ref} accessibilityRole="button"
      accessibilityLabel={achieved ? t('Goal Achieved') : `${t('Goal')}: ${t(STATUS_LABELS[goal.status])}`}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={menu.open} hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => ({ minHeight: CHIP_HEIGHT, paddingHorizontal: 8, alignItems: 'center',
        justifyContent: 'center', borderRadius: 8,
        backgroundColor: chipTriggerBackground({ pressed, open: !!menu.anchor }, colors.muted) })}>
      {/* Breathing is the one thing that says a goal is still being worked on
          between turns, when nothing else on screen is moving. */}
      <Pulse active={goal.status === 'active'}><Icon size={16} color={tone} /></Pulse>
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Goal" onDismiss={menu.close} width={340}
      titleAccessory={<GoalStatusBadge goal={goal} />}>
      <GoalMenu goal={goal} capability={capability}
        onEdit={() => { menu.close(); onEdit() }}
        onClear={() => { menu.close(); onClear() }}
        onPause={() => { menu.close(); onPause() }}
        onResume={() => { menu.close(); onResume() }}
        onDismiss={() => { menu.close(); onDismiss() }} />
    </AnchoredMenu>
  </>
}

/**
 * The goal's state, on the menu's title row rather than in its body.
 *
 * Exported for the same reason `GoalMenu` is: the title row belongs to
 * `AnchoredMenu`, which only renders once a real layout pass has measured the
 * trigger — something jest never performs.
 *
 * It reads as a status, not an action: `complete` is the one state worth a
 * colour, since it is the only one that says the session is done with the goal.
 */
export function GoalStatusBadge({ goal }: { goal: SessionGoal }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const complete = goal.status === 'complete'
  return <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 8 }}>
    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
      backgroundColor: complete ? `${colors.success}20` : colors.muted }}>
      <Text style={{ fontSize: 11, fontWeight: '500', color: complete ? colors.success : colors.mutedForeground }}>
        {t(STATUS_LABELS[goal.status])}
      </Text>
    </View>
  </View>
}

/**
 * One action in the menu's single action row.
 *
 * The visible label is abbreviated so three fit across; `name` carries the
 * unabbreviated one, because "Clear" beside a bin glyph is not enough for a
 * screen reader to say what is being cleared.
 */
function GoalAction({ label, name, icon: Icon, tone, onPress }: {
  label: string; name: string; icon: LucideIcon; tone?: string; onPress: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const color = tone ?? colors.foreground
  return <Pressable accessibilityRole="button" accessibilityLabel={t(name)} onPress={onPress} hitSlop={ACTION_HIT_SLOP}
    style={({ pressed }) => ({ flex: 1, minWidth: 0, height: 34, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 4, borderRadius: radius.sm,
      backgroundColor: pressed ? colors.border : colors.muted })}>
    <Icon size={14} color={color} />
    <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '500', color }}>{t(label)}</Text>
  </Pressable>
}

/**
 * The menu's body, exported so it can be tested without a layout pass —
 * `useMenuAnchor` measures a real view, which never happens under jest.
 */
export function GoalMenu({ goal, capability, onEdit, onClear, onPause, onResume, onDismiss }:
  GoalChipProps & { goal: SessionGoal }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const achieved = goal.status === 'complete'
  // Blocked counts as resumable: the harness stopped itself, and the user
  // telling it to go again is how that state is meant to be left.
  const canPause = capability.canPause && goal.status === 'active'
  const canResume = capability.canPause && (goal.status === 'paused' || goal.status === 'blocked')
  return <>
    {/* The objective is the whole point of the menu, so it reads at body size
        and is never clipped. It scrolls inside a cap instead: a long one has to
        stay fully readable without pushing the actions off the bottom. */}
    <ScrollView style={{ maxHeight: OBJECTIVE_MAX_HEIGHT }} nestedScrollEnabled
      contentContainerStyle={{ paddingHorizontal: 8 }}>
      <Text style={{ fontSize: 15, lineHeight: 21, color: colors.foreground }}>{goal.objective}</Text>
    </ScrollView>
    {/* Only harnesses that run an evaluator report one; absent means "not
        reported", so the line is left out rather than shown empty. */}
    {goal.lastReason ? <Text numberOfLines={3}
      style={{ paddingHorizontal: 8, paddingTop: 4, fontSize: 11, lineHeight: 15, color: colors.mutedForeground }}>
      {`${t('Latest check')}: ${goal.lastReason}`}
    </Text> : null}
    <MenuSeparator />
    {/* One row, never a stack: at most three actions exist, and stacking them
        spent more height than the objective they act on. */}
    <View style={{ flexDirection: 'row', gap: 6, padding: 4 }}>
      {achieved
        ? <GoalAction label="Dismiss" name="Dismiss" icon={X} onPress={onDismiss} />
        : <>
          <GoalAction label="Edit" name="Edit goal" icon={Pencil} onPress={onEdit} />
          {canPause ? <GoalAction label="Pause" name="Pause goal" icon={Pause} onPress={onPause} /> : null}
          {canResume ? <GoalAction label="Resume" name="Resume goal" icon={Play} onPress={onResume} /> : null}
          <GoalAction label="Clear" name="Clear goal" icon={Trash2} tone={colors.destructive} onPress={onClear} />
        </>}
    </View>
  </>
}
