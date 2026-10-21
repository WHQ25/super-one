import { describe, expect, it } from 'vitest'
import type { AgentEvent } from './agent-types'
import { MonitorSessionHold } from './monitor-session-hold'

function play(hold: MonitorSessionHold, event: AgentEvent): AgentEvent[] {
  hold.note(event)
  const outgoing = hold.adjust(event)
  const follow = hold.followUp()
  return follow ? [outgoing, follow] : [outgoing]
}

describe('MonitorSessionHold', () => {
  it('rewrites the turn-end idle to background while a monitor is live', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'status_change', status: 'streaming' })
    play(hold, {
      type: 'task_started',
      taskId: 'mon-1',
      description: 'watch build',
      taskType: 'monitor',
    })
    expect(play(hold, { type: 'status_change', status: 'idle' })).toEqual([
      { type: 'status_change', status: 'background' },
    ])
  })

  it('returns to idle when the last monitor finishes outside a turn', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'status_change', status: 'streaming' })
    play(hold, { type: 'task_started', taskId: 'mon-1', description: 'watch', taskType: 'monitor' })
    play(hold, { type: 'status_change', status: 'idle' })
    expect(play(hold, {
      type: 'task_notification',
      taskId: 'mon-1',
      taskStatus: 'completed',
      outputFile: '',
      summary: 'exit 0',
    })).toEqual([
      {
        type: 'task_notification',
        taskId: 'mon-1',
        taskStatus: 'completed',
        outputFile: '',
        summary: 'exit 0',
      },
      { type: 'status_change', status: 'idle' },
    ])
  })

  it('marks the session background when a monitor starts after the turn is idle', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'status_change', status: 'streaming' })
    play(hold, { type: 'status_change', status: 'idle' })
    expect(play(hold, {
      type: 'task_started',
      taskId: 'mon-1',
      description: 'tail log',
      taskType: 'monitor',
    }).at(-1)).toEqual({ type: 'status_change', status: 'background' })
  })

  it('does not cover a streaming turn or a bash background task', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'status_change', status: 'streaming' })
    expect(play(hold, {
      type: 'task_started',
      taskId: 'bash-1',
      description: 'sleep',
      taskType: 'bash',
    })).toEqual([{
      type: 'task_started',
      taskId: 'bash-1',
      description: 'sleep',
      taskType: 'bash',
    }])
    expect(play(hold, { type: 'status_change', status: 'idle' })).toEqual([
      { type: 'status_change', status: 'idle' },
    ])
  })

  it('leaves an error status in place', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'task_started', taskId: 'mon-1', description: 'watch', taskType: 'monitor' })
    expect(play(hold, { type: 'status_change', status: 'error' })).toEqual([
      { type: 'status_change', status: 'error' },
    ])
  })

  it('restores background on the next event after an error while the monitor is live', () => {
    const hold = new MonitorSessionHold()
    play(hold, { type: 'task_started', taskId: 'mon-1', description: 'watch', taskType: 'monitor' })
    play(hold, { type: 'status_change', status: 'error' })
    expect(play(hold, {
      type: 'task_progress',
      taskId: 'mon-1',
      description: 'watch',
      usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    }).at(-1)).toEqual({ type: 'status_change', status: 'background' })
  })
})
