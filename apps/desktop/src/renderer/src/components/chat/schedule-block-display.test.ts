import { describe, expect, it } from 'vitest'
import { parseScheduleBlock, scheduleBlockSummaryText } from './schedule-block-display'

describe('parseScheduleBlock', () => {
  it('parses one-shot timer args and background task transcript output', () => {
    const output = [
      'Created At: 2026-11-12T08:00:00Z',
      'Tool is running as a background task with task id: 78438cf0-9ba3-45d6-8b4e-5716b251e54a/task-14',
      'Task Description: Timer: 1m 30s, Prompt: Check deployment health',
      'Task logs are available at: file:///tmp/brain/78438cf0/.system_generated/tasks/task-14.log',
    ].join('\n')

    const info = parseScheduleBlock(
      { DurationSeconds: '90', Prompt: '"Check deployment health"', TimerCondition: 'any' },
      output,
    )
    expect(info.mode).toBe('timer')
    expect(info.durationSeconds).toBe(90)
    expect(info.prompt).toBe('Check deployment health')
    expect(info.timerCondition).toBe('any')
    expect(info.shortTaskId).toBe('task-14')
    expect(info.logPath).toBe('/tmp/brain/78438cf0/.system_generated/tasks/task-14.log')
    expect(scheduleBlockSummaryText({ durationSeconds: 90, prompt: 'Check deployment health' })).toBe(
      '1m 30s · Check deployment health',
    )
  })

  it('parses cron schedule flags and treats placeholder done output as empty', () => {
    const info = parseScheduleBlock(
      {
        cronExpression: '*/5 * * * *',
        prompt: 'Poll build status',
        isDaemon: true,
        exactTiming: true,
        maxIterations: 3,
      },
      'done',
    )
    expect(info.mode).toBe('cron')
    expect(info.cronExpression).toBe('*/5 * * * *')
    expect(info.isDaemon).toBe(true)
    expect(info.exactTiming).toBe(true)
    expect(info.maxIterations).toBe(3)
    expect(info.hasPlaceholderResult).toBe(true)
    expect(info.extraText).toBeUndefined()
  })

  it('strips step execution error prefix on failure', () => {
    const info = parseScheduleBlock(
      { cronExpression: 'bad' },
      'Encountered error in step execution: invalid CronExpression: bad',
      true,
    )
    expect(info.errorMessage).toBe('invalid CronExpression: bad')
  })
})
