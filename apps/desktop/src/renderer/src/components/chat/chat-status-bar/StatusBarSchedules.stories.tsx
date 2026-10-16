import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import type { SessionSchedule } from '@superone/shared/agent-types'
import { StatusBarSchedules } from './StatusBarSchedules'

/** Status bar chip for the timers that will wake the session (Claude `session_crons`, SDK 0.3.300 shapes). */
const meta: Meta<typeof StatusBarSchedules> = {
  title: 'Chat/ChatStatusBar/Schedules',
  component: StatusBarSchedules,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="flex h-96 items-end text-xs text-muted-foreground"><Story /></div>],
}

export default meta
type Story = StoryObj<typeof StatusBarSchedules>

const LOOP: SessionSchedule = { id: '8e709dd2', schedule: '*/30 * * * *', recurring: true, prompt: 'probe ping' }
const ONE_SHOT: SessionSchedule = { id: '8c30904d', schedule: '0 9 * * *', recurring: false, prompt: 'one shot' }
const WAKEUP: SessionSchedule = { id: '618ba009', schedule: '40 23 * * *', recurring: false, prompt: '<<autonomous-loop-dynamic>>' }
const LONG: SessionSchedule = {
  id: '3f1a9c20',
  schedule: '0 */2 * * 1-5',
  recurring: true,
  prompt: 'Check the release workflow on main, compare the failing jobs with the last green run, and if the same Windows better-sqlite3 gyp step failed again, re-dispatch only that platform and report what changed since the previous attempt. Keep going until every platform is green or the same failure repeats three times.',
}

const openPopover: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /Scheduled Wakeups/ }))
  await expect(await screen.findByRole('dialog')).toBeVisible()
}

/** Nothing scheduled: the chip renders nothing. */
export const Empty: Story = { args: { schedules: [] } }

export const Single: Story = { args: { schedules: [LOOP] } }

export const SingleOpen: Story = { args: { schedules: [LOOP] }, play: openPopover }

export const MixedOpen: Story = { args: { schedules: [LOOP, ONE_SHOT, WAKEUP] }, play: openPopover }

export const LongPromptOpen: Story = { args: { schedules: [LONG, LOOP] }, play: openPopover }

export const NarrowOpen: Story = {
  args: { schedules: [LONG, ONE_SHOT] },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: openPopover,
}
