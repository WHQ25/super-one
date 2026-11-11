import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  clearUnflushedAntigravityWakeupReplay,
  disposeAntigravitySubagentTracker,
  extractParentWakeupProgress,
  hasPendingAntigravitySubagentWakeup,
  hasUnflushedAntigravityWakeupReplay,
  noteAntigravitySubagentEvents,
  waitForAntigravitySubagentWakeup,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeTempBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-bg-wakeup-'))
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

describe('antigravity background run_command and schedule wakeup', () => {
  it('holds turn open for backgrounded run_command, backfills spilled Bash output, and streams wakeup reply', async () => {
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
        input_tokens: 1200,
        output_tokens: 90,
        cache_read_tokens: 8000,
        tool_calls: [{ id: 'call_bg_494', name: 'run_command', args: { CommandLine: cmd, WaitMsBeforeAsync: 5000, toolSummary: 'Run unit tests' } }],
      }),
      JSON.stringify({
        step_index: 494,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-494\nTask Description: ${cmd}\nTask logs are available at: file://${taskLogPath}\nYOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS...`,
      }),
      JSON.stringify({
        step_index: 495,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        input_tokens: 1400,
        output_tokens: 45,
        cache_read_tokens: 8000,
        content: '正在等待本轮修改的回归测试运行完成。',
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

    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(true)
    expect(
      emitted.some(
        (e) => e.type === 'task_started' && e.taskType === 'local_bash' && e.toolUseId === 'call_bg_494' && e.taskId === `${parentSid}/task-494`,
      ),
    ).toBe(true)

    const waitPromise = waitForAntigravitySubagentWakeup(parentSid)

    const postWakeupLines = [
      ...initialLines,
      JSON.stringify({
        step_index: 496,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-494 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-494" finished with result:\nThe tool's output was truncated due to being too long. You can find the full output in a file at file://${spilledStepPath}.\n\nHere is a preview:\nCommand exited with code 0.\nLog: file://${taskLogPath}\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({
        step_index: 497,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        thinking: 'All 164 tests passed cleanly.',
        thinking_duration: '1.2s',
        content: '本轮修复与验证已全部通过（164 项测试全部通过）。',
        input_tokens: 1800,
        output_tokens: 160,
        cache_read_tokens: 8000,
      }),
    ]
    writeFileSync(transcriptPath, `${postWakeupLines.join('\n')}\n`, 'utf8')

    expect(await waitPromise).toBe('completed')
    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(false)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(true)

    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'msg-bg-1' &&
          e.delta.type === 'tool_result' &&
          e.delta.toolUseId === 'call_bg_494' &&
          e.delta.summary === 'ALL 164 TESTS PASSED' &&
          e.delta.isError === false,
      ),
    ).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_bg_494' && e.taskStatus === 'completed')).toBe(true)
    expect(
      emitted.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'msg-bg-1' &&
          e.delta.type === 'text' &&
          e.delta.id === 'agy_wakeup_text_497' &&
          e.delta.text === '本轮修复与验证已全部通过（164 项测试全部通过）。',
      ),
    ).toBe(true)

    clearUnflushedAntigravityWakeupReplay(parentSid)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(false)
  })

  it('waits across chained background run_command calls inside wakeup steps and marks non-zero exit as error', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-chained-512'
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
      JSON.stringify({ step_index: 513, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '正在执行 git commit 并等待钩子检查完成。' }),
    ]
    writeFileSync(transcriptPath, `${baseLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-chain-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-chain-1',
          delta: { type: 'tool_use', toolUseId: 'call_512', toolName: 'Bash', input: JSON.stringify({ command: 'git commit -m test' }), status: 'streaming' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    const waitPromise = waitForAntigravitySubagentWakeup(parentSid)

    const midWakeupLines = [
      ...baseLines,
      JSON.stringify({
        step_index: 514,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-512 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-512" finished with result:\nCommand exited with code 1.\n\nCommand output:\npre-commit hook failed\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({
        step_index: 519,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_520', name: 'run_command', args: { CommandLine: 'git commit --no-verify -m fixed', WaitMsBeforeAsync: 5000 } }],
      }),
      JSON.stringify({
        step_index: 520,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-520`,
      }),
      JSON.stringify({ step_index: 521, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '稍等二次提交命令完成。' }),
    ]
    writeFileSync(transcriptPath, `${midWakeupLines.join('\n')}\n`, 'utf8')

    expect(extractParentWakeupProgress(`${midWakeupLines.join('\n')}\n`, 512).completed).toBe(false)
    await new Promise((r) => setTimeout(r, 320))

    const finalLines = [
      ...midWakeupLines,
      JSON.stringify({
        step_index: 522,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-520 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-520" finished with result:\nCommand exited with code 0.\n\nCommand output:\n[main ec400c2] fixed\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({ step_index: 523, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '已完成独立提交 `ec400c2`。' }),
    ]
    writeFileSync(transcriptPath, `${finalLines.join('\n')}\n`, 'utf8')

    expect(await waitPromise).toBe('completed')
    expect(
      emitted.some(
        (e) => e.type === 'content_delta' && e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_512' && e.delta.summary === 'pre-commit hook failed' && e.delta.isError === true,
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) => e.type === 'content_delta' && e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_520' && e.delta.summary === '[main ec400c2] fixed' && e.delta.isError === false,
      ),
    ).toBe(true)
    expect(
      emitted.some(
        (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.id === 'agy_wakeup_text_523' && e.delta.text === '已完成独立提交 `ec400c2`。',
      ),
    ).toBe(true)
  })

  it('does not block turn end for IsDaemon=true, and delivers idle wakeup when daemon later exits', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-daemon-1'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    const initialLines = [
      JSON.stringify({ step_index: 10, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Start dev server' }),
      JSON.stringify({
        step_index: 11,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_daemon_12', name: 'run_command', args: { CommandLine: 'bun run dev', IsDaemon: true, WaitMsBeforeAsync: 1000 } }],
      }),
      JSON.stringify({
        step_index: 12,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-12`,
      }),
      JSON.stringify({ step_index: 13, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '开发服务器已在后台启动。' }),
    ]
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    let completedIdleCount = 0
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-daemon-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-daemon-1',
          delta: { type: 'tool_use', toolUseId: 'call_daemon_12', toolName: 'Bash', input: JSON.stringify({ command: 'bun run dev', run_in_background: true }), status: 'streaming' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
      {
        isPromptActive: () => false,
        ensureMessage: () => 'acp_wake_daemon_1',
        completeMessage: () => {
          completedIdleCount += 1
        },
      },
    )

    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(false)

    const crashedLines = [
      ...initialLines,
      JSON.stringify({
        step_index: 14,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-12 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-12" finished with result:\nCommand exited with code 1.\n\nCommand output:\nEADDRINUSE: port 5173\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({ step_index: 15, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '后台开发服务器因端口 5173 冲突退出。' }),
    ]
    writeFileSync(transcriptPath, `${crashedLines.join('\n')}\n`, 'utf8')

    await new Promise((r) => setTimeout(r, 1150))

    expect(completedIdleCount).toBe(1)
    expect(hasUnflushedAntigravityWakeupReplay(parentSid)).toBe(true)
    expect(
      emitted.some((e) => e.type === 'content_delta' && e.messageId === 'acp_wake_daemon_1' && e.delta.type === 'text' && e.delta.text === '后台开发服务器因端口 5173 冲突退出。'),
    ).toBe(true)
  })

  it('ignores wire-completed Bash background tasks and explicit MESSAGE_PRIORITY_LOW cancellations', () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-wire-done'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ step_index: 20, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Quick check' }),
        JSON.stringify({
          step_index: 21,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: nowIso,
          tool_calls: [{ id: 'call_wire_22', name: 'run_command', args: { CommandLine: 'sleep 1 && echo ok', WaitMsBeforeAsync: 500 } }],
        }),
        JSON.stringify({
          step_index: 22,
          type: 'GENERIC',
          status: 'RUNNING',
          created_at: nowIso,
          content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-22`,
        }),
        JSON.stringify({
          step_index: 23,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: nowIso,
          content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-22 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-22" finished with result:\nCommand exited with code 0.\n\nCommand output:\nok\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({ step_index: 24, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '已同步完成。' }),
      ].join('\n') + '\n',
      'utf8',
    )

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wire-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wire-1',
          delta: { type: 'tool_use', toolUseId: 'call_wire_22', toolName: 'Bash', input: JSON.stringify({ command: 'sleep 1 && echo ok' }), status: 'complete' },
        },
        {
          type: 'content_delta',
          messageId: 'msg-wire-1',
          delta: { type: 'tool_result', toolUseId: 'call_wire_22', toolName: 'Bash', isError: false, summary: 'ok' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(false)
    expect(emitted).toHaveLength(0)

    const cancelledRaw = [
      JSON.stringify({ step_index: 30, type: 'GENERIC', status: 'DONE', created_at: nowIso, content: `Task "${parentSid}/task-29" cancelled.` }),
      JSON.stringify({
        step_index: 31,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-29 priority=MESSAGE_PRIORITY_LOW content=Task id "${parentSid}/task-29" was canceled with result:\n\n</SYSTEM_MESSAGE>`,
      }),
    ].join('\n')
    expect(extractParentWakeupProgress(cancelledRaw, 28).completed).toBe(false)
  })

  it('holds turn open for one-shot non-daemon schedule timer until wakeup PLANNER_RESPONSE completes', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-sched-1'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    const initialLines = [
      JSON.stringify({ step_index: 40, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Remind in 2s' }),
      JSON.stringify({
        step_index: 41,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_sched_42', name: 'schedule', args: { DurationSeconds: 2, Prompt: 'Check status' } }],
      }),
      JSON.stringify({
        step_index: 42,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-42`,
      }),
      JSON.stringify({ step_index: 43, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '已设置 2 秒定时器。' }),
    ]
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-sched-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-sched-1',
          delta: { type: 'tool_use', toolUseId: 'call_sched_42', toolName: 'schedule', input: JSON.stringify({ DurationSeconds: 2, Prompt: 'Check status' }), status: 'complete' },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(hasPendingAntigravitySubagentWakeup(parentSid)).toBe(true)
    const waitPromise = waitForAntigravitySubagentWakeup(parentSid)

    writeFileSync(
      transcriptPath,
      [
        ...initialLines,
        JSON.stringify({
          step_index: 44,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: nowIso,
          content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-42 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-42" finished with result:\nCheck status\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({ step_index: 45, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: '定时器已触发，状态正常。' }),
      ].join('\n') + '\n',
      'utf8',
    )

    expect(await waitPromise).toBe('completed')
    expect(emitted.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '定时器已触发，状态正常。')).toBe(true)
  })
})
