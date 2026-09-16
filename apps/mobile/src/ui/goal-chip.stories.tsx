import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { SessionGoal, SessionGoalStatus } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES, resolveGoalCapability, type GoalCapability } from '@superone/shared/harness/harness-capabilities'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { GoalChip, GoalMenu, GoalStatusBadge } from './goal-chip'

const GROK = resolveGoalCapability('acp', 'grok-build')!
const CLAUDE = HARNESS_CAPABILITIES.claude.goal!
const CODEX = HARNESS_CAPABILITIES.codex.goal!

const noop = {
  onEdit: () => {}, onClear: () => {}, onPause: () => {}, onResume: () => {}, onDismiss: () => {},
}

const goal = (status: SessionGoalStatus, extra: Partial<SessionGoal> = {}): SessionGoal =>
  ({ objective: 'Ship the login flow end to end, including the reset email', status, ...extra })

const LONG = 'Keep going until every package typechecks, the desktop and mobile suites are green, '
  + 'and no story in the shared UI renders a component that no longer exists in the app'

function Case({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: 4 }}>
    <Text style={{ fontSize: 12, opacity: 0.6 }}>{label}</Text>
    {children}
  </View>
}

/**
 * The title row `AnchoredMenu` would draw. It is restated here because the
 * popover needs a measured trigger to mount, which a story frame never gives it
 * — and the state badge lives on that row, so without it these cases would not
 * show what state they are in.
 */
function TitleRow({ goal }: { goal: SessionGoal }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8 }}>
    <Text style={{ fontSize: 12, opacity: 0.7 }}>Goal</Text>
    <GoalStatusBadge goal={goal} />
  </View>
}

function MenuCase({ label, goal, capability }: { label: string; goal: SessionGoal; capability: GoalCapability }) {
  return <Case label={label}>
    <TitleRow goal={goal} />
    <GoalMenu goal={goal} capability={capability} {...noop} />
  </Case>
}

/** The chip as the composer's readout row holds it: a glyph, not a label. */
function Chips() {
  return <MobileThemeProvider>
    <View style={{ width: 390, padding: 12, gap: 20 }}>
      <Case label="Active · the icon breathes while the goal is being pursued">
        <GoalChip goal={goal('active')} capability={GROK} {...noop} />
      </Case>
      <Case label="Paused · resting, so the row stops moving">
        <GoalChip goal={goal('paused')} capability={GROK} {...noop} />
      </Case>
      <Case label="Achieved · green check; tap for the one remaining action">
        <GoalChip goal={goal('complete')} capability={GROK} {...noop} />
      </Case>
      <Case label="No goal · nothing is drawn at all">
        <GoalChip goal={null} capability={GROK} {...noop} />
      </Case>
    </View>
  </MobileThemeProvider>
}

/**
 * The tap-opened menu, rendered directly — `useMenuAnchor` needs a real layout
 * pass to place the popover, which a story frame does not give it.
 */
function Menus() {
  return <MobileThemeProvider>
    <View style={{ width: 340, padding: 12, gap: 24 }}>
      <MenuCase label="Grok · full lifecycle, because the capability has one"
        goal={goal('active')} capability={GROK} />
      <MenuCase label="Grok paused · resume takes pause's place"
        goal={goal('paused', { lastReason: 'waiting on the migration to finish' })} capability={GROK} />
      <MenuCase label="Grok blocked · still resumable; the user is how it gets unstuck"
        goal={goal('blocked', { lastReason: 'the test database is unreachable' })} capability={GROK} />
      <MenuCase label="Claude · a condition with no pause lifecycle"
        goal={{ objective: 'every suite passes', status: 'active', lastReason: 'two suites still red' }}
        capability={CLAUDE} />
      <MenuCase label="Codex · host-driven, so pause and resume are RPCs"
        goal={goal('active')} capability={CODEX} />
      <MenuCase label="Achieved · the harness already cleared it, so only Dismiss remains"
        goal={goal('complete')} capability={GROK} />
      <MenuCase label="Long objective · scrolls inside its cap, keeping the actions on screen"
        goal={{ objective: LONG, status: 'active' }} capability={GROK} />
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/GoalChip',
  component: GoalChip,
  render: Chips,
}

export const Chip = { render: Chips }
export const Menu = { render: Menus }
