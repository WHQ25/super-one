import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { MonitorSessionHold } from '@superone/shared/monitor-session-hold'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  extractBackgroundTaskLaunchFromText,
  extractSpawnedBackgroundTasksFromTranscript,
} from './antigravity-background-task-transcript'
import {
  disposeAntigravitySubagentTracker,
  noteAntigravitySubagentEvents,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-bg-guard-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity background task launch detection guard', () => {
  it('ignores quoted launch patterns inside read_file and finished run_command outputs without holding MonitorSessionHold', () => {
    const brainRoot = makeBrainRoot()
    const parentSid = '4f7cc1ca-b644-4755-8413-54768ea3a18e'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    const sourceSnippet = [
      `Created At: ${nowIso}`,
      `Completed At: ${nowIso}`,
      'Showing lines 1-10 of 374',
      '5: const BACKGROUND_TASK_ID_RE = /Tool is running as a background task with task id:\\s*([^\\r\\n]+)/',
      '6: const BACKGROUND_TASK_LOG_RE = /Task logs are available at:\\s*([^\\r\\n]+)/',
    ].join('\n')

    const docsSnippet = [
      `Created At: ${nowIso}`,
      `Completed At: ${nowIso}`,
      'Showing lines 91-100 of 159',
      '96: - `run_command` appends `Tool is running as a background task with task id: <sessionId>/task-<stepIndex>` and `Task logs are available at: file:///.../.system_generated/tasks/task-<stepIndex>.log`.',
    ].join('\n')

    const finishedCmdOutput = [
      `Created At: ${nowIso}`,
      `Completed At: ${nowIso}`,
      'Command exited with code 0.',
      '',
      'Command output:',
      `Tool is running as a background task with task id: ${parentSid}/task-999`,
      `Task logs are available at: file:///tmp/fake/task-999.log`,
    ].join('\n')

    const raw = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Review code' }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [
          { name: 'read_file', args: { Path: '/repo/antigravity-background-task-transcript.ts' } },
          { name: 'read_file', args: { Path: '/repo/docs/harness/acp-antigravity/contracts.md' } },
          { id: 'call_rg_1', name: 'run_command', args: { CommandLine: 'rg -n "background task"', WaitMsBeforeAsync: 5000 } },
        ],
      }),
      JSON.stringify({ step_index: 3, type: 'GENERIC', status: 'DONE', created_at: nowIso, content: sourceSnippet }),
      JSON.stringify({ step_index: 4, type: 'GENERIC', status: 'DONE', created_at: nowIso, content: docsSnippet }),
      JSON.stringify({ step_index: 5, type: 'GENERIC', status: 'DONE', created_at: nowIso, content: finishedCmdOutput }),
      JSON.stringify({ step_index: 6, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: 'Done reviewing.' }),
    ].join('\n') + '\n'
    writeFileSync(transcriptPath, raw, 'utf8')

    expect(extractSpawnedBackgroundTasksFromTranscript(raw).tasks).toEqual([])

    const hold = new MonitorSessionHold()
    const emitted: AgentEvent[] = []
    const record = (ev: AgentEvent) => {
      emitted.push(ev)
      hold.note(ev)
    }

    noteAntigravitySubagentEvents(
      parentSid,
      'msg-read-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-read-1',
          delta: { type: 'tool_use', toolUseId: 'call_rg_1', toolName: 'Bash', input: JSON.stringify({ command: 'rg -n "background task"' }), status: 'streaming' },
        },
        {
          type: 'content_delta',
          messageId: 'msg-read-1',
          delta: { type: 'tool_result', toolUseId: 'call_rg_1', summary: finishedCmdOutput, isError: false },
        },
      ],
      record,
      [brainRoot],
    )

    expect(emitted.some((e) => e.type === 'task_started')).toBe(false)
    expect(hold.adjust({ type: 'status_change', status: 'idle' })).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('still extracts genuine background run_command and schedule launches', () => {
    const nowIso = new Date().toISOString()
    const sid = '78438cf0-9ba3-45d6-8b4e-5716b251e54a'

    expect(
      extractBackgroundTaskLaunchFromText(
        `Created At: ${nowIso}\nTool is running as a background task with task id: ${sid}/task-12\nTask logs are available at: file:///tmp/task-12.log`,
      ),
    ).toEqual({ taskId: `${sid}/task-12`, logFile: '/tmp/task-12.log' })

    expect(
      extractBackgroundTaskLaunchFromText(
        `Tool is running as a background task with task id: ${sid}/task-14`,
      ),
    ).toEqual({ taskId: `${sid}/task-14` })

    expect(
      extractBackgroundTaskLaunchFromText(
        'Command exited with code 0.\nTool is running as a background task with task id: sid/task-1',
      ),
    ).toBeNull()

    expect(
      extractBackgroundTaskLaunchFromText(
        'Tool is running as a background task with task id: \\s*([^\\r\\n]+)/',
      ),
    ).toBeNull()
  })
})
