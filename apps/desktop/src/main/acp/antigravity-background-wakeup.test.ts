import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  disposeAntigravitySubagentTracker,
  markAntigravityForegroundTurnEnded,
  noteAntigravitySubagentEvents,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeTempBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-bg-task-'))
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

describe('antigravity background run_command live tracking', () => {
  it('emits task_started and backfills spilled Bash output and task_notification on completion', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-bg-494'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const tasksDir = join(brainRoot, parentSid, '.system_generated', 'tasks')
    const stepOutDir = join(brainRoot, parentSid, '.system_generated', 'steps', '494')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(tasksDir, { recursive: true })
    mkdirSync(stepOutDir, { recursive: true })

    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const taskLogPath = join(tasksDir, 'task-494.log')
    const spilledStepPath = join(stepOutDir, 'output.txt')
    writeFileSync(taskLogPath, 'running vitest...\n', 'utf8')
    writeFileSync(
      spilledStepPath,
      'Created At: 2026-11-12T01:27:56+08:00\nCompleted At: 2026-11-12T01:28:20+08:00\nCommand exited with code 0.\n\nCommand output:\nALL 164 TESTS PASSED\n',
      'utf8',
    )

    const nowIso = new Date().toISOString()
    const cmd = 'bunx vitest run src/renderer/UsageStatusIcon.test.tsx'
    const initialLines = [
      JSON.stringify({ step_index: 492, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run regression tests' }),
      JSON.stringify({
        step_index: 493,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_bg_494', name: 'run_command', args: { CommandLine: cmd, WaitMsBeforeAsync: 5000, toolSummary: 'Run unit tests' } }],
      }),
      JSON.stringify({
        step_index: 494,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-494\nTask Description: ${cmd}\nTask logs are available at: file://${taskLogPath}\n`,
      }),
    ]
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-bg-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-bg-1',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_bg_494',
            toolName: 'Bash',
            input: JSON.stringify({ command: cmd, description: 'Run unit tests' }),
            status: 'streaming',
            toolSummary: 'Run unit tests',
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(
      emitted.some(
        (e) => e.type === 'task_started' && e.taskType === 'local_bash' && e.toolUseId === 'call_bg_494' && e.taskId === `${parentSid}/task-494`,
      ),
    ).toBe(true)

    const completedLines = [
      ...initialLines,
      JSON.stringify({
        step_index: 496,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-494 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-494" finished with result:\nThe tool's output was truncated due to being too long. You can find the full output in a file at file://${spilledStepPath}.\n\nHere is a preview:\nCommand exited with code 0.\nLog: file://${taskLogPath}\n</SYSTEM_MESSAGE>`,
      }),
    ]
    writeFileSync(transcriptPath, `${completedLines.join('\n')}\n`, 'utf8')

    await vi.waitFor(() => {
      expect(
        emitted.some(
          (e) =>
            e.type === 'content_delta' &&
            e.messageId === 'msg-bg-1' &&
            e.delta.type === 'tool_result' &&
            e.delta.toolUseId === 'call_bg_494' &&
            e.delta.summary === 'ALL 164 TESTS PASSED' &&
            e.delta.outputPath === taskLogPath &&
            e.delta.isError === false,
        ),
      ).toBe(true)
    })
    expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_bg_494' && e.taskStatus === 'completed')).toBe(true)
  })

  it('marks non-zero exit background run_command as failed and backfills tool_result error', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-err-512'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    const baseLines = [
      JSON.stringify({ step_index: 510, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Commit changes' }),
      JSON.stringify({
        step_index: 511,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_512', name: 'run_command', args: { CommandLine: 'git commit -m test', WaitMsBeforeAsync: 5000 } }],
      }),
      JSON.stringify({
        step_index: 512,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-512`,
      }),
    ]
    writeFileSync(transcriptPath, `${baseLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-err-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-err-1',
          delta: { type: 'tool_use', toolUseId: 'call_512', toolName: 'Bash', input: JSON.stringify({ command: 'git commit -m test' }), status: 'streaming' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    writeFileSync(
      transcriptPath,
      [
        ...baseLines,
        JSON.stringify({
          step_index: 514,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: nowIso,
          content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-512 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-512" finished with result:\nCommand exited with code 1.\n\nCommand output:\npre-commit hook failed\n</SYSTEM_MESSAGE>`,
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    markAntigravityForegroundTurnEnded(parentSid)

    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.delta.type === 'tool_result' &&
          e.delta.toolUseId === 'call_512' &&
          e.delta.summary === 'pre-commit hook failed' &&
          e.delta.isError === true,
      ),
    ).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_512' && e.taskStatus === 'failed')).toBe(true)
  })

  it('does not track IsDaemon=true background commands or wire-completed Bash calls', () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-daemon-and-wire'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ step_index: 10, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run dev & check' }),
        JSON.stringify({
          step_index: 11,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: nowIso,
          tool_calls: [
            { id: 'call_daemon_12', name: 'run_command', args: { CommandLine: 'bun run dev', IsDaemon: true, WaitMsBeforeAsync: 1000 } },
            { id: 'call_wire_13', name: 'run_command', args: { CommandLine: 'echo ok', WaitMsBeforeAsync: 500 } },
          ],
        }),
        JSON.stringify({
          step_index: 12,
          type: 'GENERIC',
          status: 'RUNNING',
          created_at: nowIso,
          content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-12`,
        }),
        JSON.stringify({
          step_index: 13,
          type: 'GENERIC',
          status: 'RUNNING',
          created_at: nowIso,
          content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-13`,
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-daemon-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-daemon-1',
          delta: { type: 'tool_use', toolUseId: 'call_daemon_12', toolName: 'Bash', input: JSON.stringify({ command: 'bun run dev', run_in_background: true }), status: 'streaming' },
        },
        {
          type: 'content_delta',
          messageId: 'msg-daemon-1',
          delta: { type: 'tool_use', toolUseId: 'call_wire_13', toolName: 'Bash', input: JSON.stringify({ command: 'echo ok' }), status: 'complete' },
        },
        {
          type: 'content_delta',
          messageId: 'msg-daemon-1',
          delta: { type: 'tool_result', toolUseId: 'call_wire_13', toolName: 'Bash', isError: false, summary: 'ok' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted).toHaveLength(0)
  })
})
