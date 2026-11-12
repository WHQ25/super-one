import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ScheduleToolBlock } from './ScheduleToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function block(
  params: Record<string, unknown>,
  result: string | undefined,
  options: {
    toolName?: string
    isStreaming?: boolean
    isError?: boolean
    isDenied?: boolean
  } = {},
) {
  return (
    <ToolBlock
      toolName={options.toolName ?? 'Schedule'}
      input={JSON.stringify(params)}
      result={
        options.isDenied
          ? '[denied] User denied permission'
          : options.isStreaming
            ? undefined
            : result
      }
      status={options.isStreaming ? 'streaming' : 'complete'}
      isError={options.isError}
    />
  )
}

function compact(params: Record<string, unknown>, result: string | undefined) {
  return <ScheduleToolBlock params={params} result={result} isStreaming={false} allowExpand={false} />
}

const TIMER_OUTPUT = [
  'Tool is running as a background task with task id: 78438cf0-9ba3-45d6-8b4e-5716b251e54a/task-14',
  'Task Description: Timer: 1m 30s, Prompt: Check deployment rollout health',
  'Task logs are available at: file:///Users/dev/.gemini/antigravity-cli/brain/78438cf0/.system_generated/tasks/task-14.log',
].join('\n')

const CRON_OUTPUT = [
  'Tool is running as a background task with task id: 78438cf0-9ba3-45d6-8b4e-5716b251e54a/task-22',
  'Task Description: Cron: */5 * * * *, Prompt: Poll staging build pipeline status',
  'Task logs are available at: file:///Users/dev/.gemini/antigravity-cli/brain/78438cf0/.system_generated/tasks/task-22.log',
].join('\n')

const meta: Meta = {
  title: 'Tool UI/General/Schedule',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const TimersAndCrons: Story = {
  render: () => (
    <>
      {block(
        {
          durationSeconds: 90,
          prompt: 'Check deployment rollout health and verify smoke tests.',
          timerCondition: 'any',
        },
        TIMER_OUTPUT,
      )}
      {block(
        {
          cronExpression: '*/5 * * * *',
          prompt: 'Poll staging build pipeline status until artifacts are published.',
          isDaemon: true,
          exactTiming: true,
          maxIterations: 6,
        },
        CRON_OUTPUT,
      )}
    </>
  ),
}

export const StatesAndCompact: Story = {
  render: () => (
    <>
      {block({ durationSeconds: 30, prompt: 'Verify background server readiness' }, undefined, { isStreaming: true })}
      {block(
        { cronExpression: 'invalid cron', prompt: 'Run health check' },
        'Encountered error in step execution: invalid CronExpression: expected 5 fields',
        { isError: true },
      )}
      {block({ durationSeconds: 60, prompt: 'Check task output' }, undefined, { isDenied: true })}
      {compact({ durationSeconds: 90, prompt: 'Check deployment rollout health' }, TIMER_OUTPUT)}
    </>
  ),
}
