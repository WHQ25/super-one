import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

/**
 * Session timer tools: Claude CronCreate / CronList / CronDelete / ScheduleWakeup and
 * Grok scheduler_*. Claude results are SDK 0.3.300 output captured from live calls.
 */
function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/General/Scheduling Tools',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const CronCreateStreaming: Story = {
  args: { toolName: 'CronCreate', input: JSON.stringify({ cron: '*/30 * * * *', prompt: 'probe ping', recurring: true }), status: 'streaming', elapsedSeconds: 1 },
}

export const CronCreateRecurring: Story = {
  args: {
    toolName: 'CronCreate',
    input: JSON.stringify({ cron: '*/30 * * * *', prompt: 'probe ping', recurring: true }),
    status: 'complete',
    result: 'Scheduled recurring job 8e709dd2 (Every 30 minutes). Next run: Oct 16 11:38pm. Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.',
  },
}

export const CronCreateOneShot: Story = {
  args: {
    toolName: 'CronCreate',
    input: JSON.stringify({ cron: '0 9 * * *', prompt: 'one shot', recurring: false }),
    status: 'complete',
    result: 'Scheduled one-shot task 8c30904d (Every day at 9:00 AM). Next run: Oct 17 8:59am. Session-only (not written to disk, dies when Claude exits). It will fire once then auto-delete.',
  },
}

export const CronCreateLongPrompt: Story = {
  args: {
    toolName: 'CronCreate',
    input: JSON.stringify({
      cron: '0 */2 * * 1-5',
      prompt: 'Check the release workflow on main, compare the failing jobs with the last green run, and if the same Windows better-sqlite3 gyp step failed again, re-dispatch only that platform and report what changed since the previous attempt.',
      recurring: true,
    }),
    status: 'complete',
    result: 'Scheduled recurring job 3f1a9c20 (Every 2 hours, Monday through Friday). Next run: Oct 17 12:00am. Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.',
  },
}

export const CronCreateNarrow: Story = {
  ...CronCreateLongPrompt,
  decorators: [(Story) => <StoryShell width={320}><Story /></StoryShell>],
}

export const CronCreateDenied: Story = {
  args: { toolName: 'CronCreate', input: JSON.stringify({ cron: '*/5 * * * *', prompt: 'poll' }), status: 'complete', result: '[denied] User denied permission' },
}

export const CronList: Story = {
  args: {
    toolName: 'CronList',
    input: '{}',
    status: 'complete',
    result: '8e709dd2 — Every 30 minutes (recurring) [session-only], next run Oct 16 11:38pm: probe ping\n8c30904d — Every day at 9:00 AM (one-shot) [session-only], next run Oct 17 8:59am: one shot\n618ba009 — Every day at 11:40 PM (one-shot) [session-only], next run Oct 16 11:40pm: check CI',
  },
}

export const CronListEmpty: Story = {
  args: { toolName: 'CronList', input: '{}', status: 'complete', result: 'No scheduled jobs.' },
}

export const CronDelete: Story = {
  args: { toolName: 'CronDelete', input: JSON.stringify({ id: '8e709dd2' }), status: 'complete', result: 'Cancelled job 8e709dd2.' },
}

export const ScheduleWakeup: Story = {
  args: {
    toolName: 'ScheduleWakeup',
    input: JSON.stringify({ delaySeconds: 1200, reason: 'watching CI', prompt: 'check CI' }),
    status: 'complete',
    result: 'Next wakeup scheduled for 23:40:00 (in 1212s). If you owe the user a status update this tick, write it now as ordinary response text; then end the turn — the harness re-invokes you when the wakeup fires or a task-notification arrives.',
  },
}

export const ScheduleWakeupStop: Story = {
  args: {
    toolName: 'ScheduleWakeup',
    input: JSON.stringify({ stop: true }),
    status: 'complete',
    result: 'Loop stopped — any dynamic loop in this session is ended; there was no pending wakeup to cancel. If you are running a fixed-interval /loop (a recurring cron), it is NOT stopped by this call — cancel it with CronDelete. If you armed a Monitor for this loop, TaskStop it now. Then write the loop\'s outcome for the user as ordinary visible response text — and end the turn.',
  },
}

export const GrokSchedulerCreate: Story = {
  args: { toolName: 'SchedulerCreate', input: JSON.stringify({ interval: '10m', prompt: 'poll the deploy status' }), status: 'complete', result: 'Scheduled task job-1 every 10m.' },
}

export const GrokSchedulerDeleteError: Story = {
  args: {
    toolName: 'SchedulerDelete',
    input: JSON.stringify({ id: 'job-9' }),
    status: 'complete',
    result: 'No scheduled task with ID job-9 found. Use scheduler_list to see active tasks.',
    isError: true,
  },
}
