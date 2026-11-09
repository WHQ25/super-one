import { describe, expect, it } from 'vitest'
import {
  formatSentInputPreview,
  formatTaskStartTime,
  manageTaskSummaryText,
  parseManageTask,
  shortenTaskId,
} from './manage-task-display'

const TASK_TABLE = [
  '| Start Time | Task ID | Tool | Description |',
  '|---|---|---|---|',
  '| 2026-11-09T14:01:12+08:00 | 5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-51 | run_command | Unit test execution |',
  '| 2026-11-09T14:02:45+08:00 | 5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-80 | schedule | Poll build status |',
].join('\n')

const STATUS_RUNNING = [
  'Created At: 2026-11-09T14:03:00+08:00',
  'Completed At: 2026-11-09T14:03:01+08:00',
  'Task: 8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80',
  'Status: RUNNING',
  'Log: file:///Users/dev/.gemini/antigravity-cli/brain/8ade19b2-c248-4d06-ae1d-47d68ca614d3/.system_generated/tasks/task-80.log',
  'Log output:',
  '<truncated 60 lines>',
  'VITE v6.1.0 ready in 342 ms',
  'Listening on :5173',
  '',
  'Last progress: 5s ago',
].join('\n')

describe('manage-task-display', () => {
  it('shortens conversation-scoped task IDs while preserving plain IDs', () => {
    expect(shortenTaskId('8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80')).toBe('task-80')
    expect(shortenTaskId('task-80')).toBe('task-80')
    expect(shortenTaskId(undefined)).toBeUndefined()
  })

  it('formats ISO timestamps into compact wall-clock time', () => {
    expect(formatTaskStartTime('2026-11-09T14:01:12+08:00')).toBe('14:01:12')
    expect(formatTaskStartTime('2m ago')).toBe('2m ago')
  })

  it('formats sent input into single-line quoted preview', () => {
    expect(formatSentInputPreview('y\n')).toBe('"y↵"')
    expect(formatSentInputPreview('\n')).toBe('"↵"')
    expect(formatSentInputPreview('')).toBeUndefined()
  })

  it('parses markdown task tables for list action', () => {
    const info = parseManageTask({ Action: 'list' }, TASK_TABLE)
    expect(info.action).toBe('list')
    expect(info.emptyList).toBe(false)
    expect(info.tasks).toEqual([
      {
        startTime: '2026-11-09T14:01:12+08:00',
        displayStartTime: '14:01:12',
        taskId: '5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-51',
        shortTaskId: 'task-51',
        tool: 'run_command',
        description: 'Unit test execution',
      },
      {
        startTime: '2026-11-09T14:02:45+08:00',
        displayStartTime: '14:02:45',
        taskId: '5f2f9930-88dc-4aff-8dd9-010c4aba7798/task-80',
        shortTaskId: 'task-80',
        tool: 'schedule',
        description: 'Poll build status',
      },
    ])
  })

  it('recognizes empty background task list', () => {
    const info = parseManageTask({ action: 'list' }, 'No background tasks are currently running.')
    expect(info.action).toBe('list')
    expect(info.emptyList).toBe(true)
    expect(info.tasks).toEqual([])
  })

  it('parses status output with truncated line count, log body, and last progress', () => {
    const info = parseManageTask(
      { Action: 'status', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
      STATUS_RUNNING,
    )
    expect(info.action).toBe('status')
    expect(info.shortTaskId).toBe('task-80')
    expect(info.statusInfo).toEqual({
      taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80',
      shortTaskId: 'task-80',
      status: 'running',
      rawStatus: 'RUNNING',
      logPath: '/Users/dev/.gemini/antigravity-cli/brain/8ade19b2-c248-4d06-ae1d-47d68ca614d3/.system_generated/tasks/task-80.log',
      truncatedLines: 60,
      logOutput: 'VITE v6.1.0 ready in 342 ms\nListening on :5173',
      lastProgress: '5s ago',
    })
  })

  it('parses kill and send_input confirmations and strips step error boilerplate', () => {
    const killed = parseManageTask(
      { Action: 'kill', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65' },
      'Task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65" cancelled.',
    )
    expect(killed.action).toBe('kill')
    expect(killed.shortTaskId).toBe('task-65')
    expect(killed.confirmedMessage).toBe('Task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-65" cancelled.')

    const sent = parseManageTask(
      { action: 'send_input', taskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80', input: 'yes\n' },
      'Input sent to task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80".',
    )
    expect(sent.action).toBe('send_input')
    expect(sent.sentInputPreview).toBe('"yes↵"')
    expect(manageTaskSummaryText({ action: 'send_input', taskId: 'conv/task-80', input: 'yes\n' })).toBe('task-80 · "yes↵"')

    const errored = parseManageTask(
      { Action: 'kill', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-4' },
      'Encountered error in step execution: cannot kill task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-4": task is not running (status: DONE)',
      true,
    )
    expect(errored.errorMessage).toBe(
      'cannot kill task "8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-4": task is not running (status: DONE)',
    )
  })

  it('treats bare done/failed ACP placeholders as empty rather than unstructured text', () => {
    const info = parseManageTask(
      { Action: 'status', TaskId: '8ade19b2-c248-4d06-ae1d-47d68ca614d3/task-80' },
      'done',
    )
    expect(info.hasPlaceholderResult).toBe(true)
    expect(info.extraText).toBeUndefined()
    expect(info.shortTaskId).toBe('task-80')
  })
})
