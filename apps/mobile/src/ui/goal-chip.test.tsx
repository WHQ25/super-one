import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import type { SessionGoal, SessionGoalStatus } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES, resolveGoalCapability } from '@superone/shared/harness/harness-capabilities'
import { renderWithTheme } from '../test-render'
import { GoalChip, GoalMenu, GoalStatusBadge } from './goal-chip'

const GROK = resolveGoalCapability('acp', 'grok-build')!
const CLAUDE = HARNESS_CAPABILITIES.claude.goal!

const goal = (status: SessionGoalStatus, extra: Partial<SessionGoal> = {}): SessionGoal =>
  ({ objective: 'Ship the login flow', status, ...extra })

const handlers = () => ({
  onEdit: jest.fn(), onClear: jest.fn(), onPause: jest.fn(), onResume: jest.fn(), onDismiss: jest.fn(),
})

test('the chip names the goal and its state, since the glyph alone cannot', async () => {
  // `MobileThemeProvider` carries the `MenuHost` this anchors into.
  await renderWithTheme(<GoalChip goal={goal('active')} capability={GROK} {...handlers()} />)

  expect(screen.getByLabelText('Goal: Active')).toBeTruthy()
})

test('an achieved goal says so on the chip, not only in the menu', async () => {
  await renderWithTheme(<GoalChip goal={goal('complete')} capability={GROK} {...handlers()} />)

  expect(screen.getByLabelText('Goal Achieved')).toBeTruthy()
})

test('nothing is drawn without a goal — an idle glyph would be furniture', async () => {
  await renderWithTheme(<GoalChip goal={null} capability={GROK} {...handlers()} />)

  expect(screen.queryByLabelText(/Goal/)).toBeNull()
})

test('the menu carries the objective the chip had no room for', async () => {
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...handlers()} />)

  expect(screen.getByText('Ship the login flow')).toBeTruthy()
})

// The objective reads at body size and is never clipped: a long one scrolls
// inside its cap so the action row below it stays on screen.
test('the objective wraps rather than truncating', async () => {
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...handlers()} />)

  expect(screen.getByText('Ship the login flow').props.numberOfLines).toBeUndefined()
})

test('the state rides the title row, not the body', async () => {
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...handlers()} />)

  expect(screen.queryByText('Active')).toBeNull()
})

test('the badge names the state the chip could only colour', async () => {
  await renderWithTheme(<GoalStatusBadge goal={goal('paused')} />)

  expect(screen.getByText('Paused')).toBeTruthy()
})

test('the badge says Complete for an achieved goal', async () => {
  await renderWithTheme(<GoalStatusBadge goal={goal('complete')} />)

  expect(screen.getByText('Complete')).toBeTruthy()
})

// One render per test throughout: a second render in the same test overlaps
// jest-expo's `act()` scope and takes every later test in the file down with it.
test('the latest check is left out until the harness has reported one', async () => {
  await renderWithTheme(<GoalMenu goal={goal('paused')} capability={GROK} {...handlers()} />)

  expect(screen.queryByText(/Latest check/)).toBeNull()
})

test('the latest check shows the reason the harness gave', async () => {
  await renderWithTheme(
    <GoalMenu goal={goal('paused', { lastReason: 'two suites still red' })} capability={GROK} {...handlers()} />,
  )

  expect(screen.getByText('Latest check: two suites still red')).toBeTruthy()
})

test('an active goal on a pausable harness offers pause and not resume', async () => {
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...handlers()} />)

  expect(screen.getByLabelText('Pause Goal')).toBeTruthy()
  expect(screen.queryByLabelText('Resume Goal')).toBeNull()
})

test('a harness with no pause lifecycle shows no pause row at all', async () => {
  // Absent rather than present and refused: the capability decides, never the
  // harness id.
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={CLAUDE} {...handlers()} />)

  expect(screen.queryByLabelText('Pause Goal')).toBeNull()
  expect(screen.queryByLabelText('Resume Goal')).toBeNull()
  expect(screen.getByLabelText('Clear Goal')).toBeTruthy()
})

test('a blocked goal offers resume, since the user is how it gets unstuck', async () => {
  const on = handlers()
  await renderWithTheme(<GoalMenu goal={goal('blocked')} capability={GROK} {...on} />)

  fireEvent.press(screen.getByLabelText('Resume Goal'))
  expect(on.onResume).toHaveBeenCalled()
})

/**
 * The harness clears its own goal on success, so there is nothing left to send.
 * A phone has no hover to hide a close mark behind, so dismissal is a row like
 * every other action rather than a second meaning for the same tap.
 */
test('an achieved goal offers only dismissal', async () => {
  const on = handlers()
  await renderWithTheme(<GoalMenu goal={goal('complete')} capability={GROK} {...on} />)

  expect(screen.queryByLabelText('Clear Goal')).toBeNull()
  expect(screen.queryByLabelText('Edit Goal')).toBeNull()
  fireEvent.press(screen.getByLabelText('Dismiss'))
  expect(on.onDismiss).toHaveBeenCalled()
  expect(on.onClear).not.toHaveBeenCalled()
})

test('editing hands the goal back to the composer', async () => {
  const on = handlers()
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...on} />)

  fireEvent.press(screen.getByLabelText('Edit Goal'))
  expect(on.onEdit).toHaveBeenCalled()
})

test('clearing is a separate act from dismissing', async () => {
  const on = handlers()
  await renderWithTheme(<GoalMenu goal={goal('active')} capability={GROK} {...on} />)

  fireEvent.press(screen.getByLabelText('Clear Goal'))
  expect(on.onClear).toHaveBeenCalled()
  expect(on.onDismiss).not.toHaveBeenCalled()
})
