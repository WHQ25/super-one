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
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-bg-wf-'))
  tempDirs.push(dir)
  return dir
}

function writeChildTranscript(brainRoot: string, childId: string, lines: Record<string, unknown>[]): void {
  const dir = join(brainRoot, childId, '.system_generated', 'logs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'transcript.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, 'utf8')
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity background run_workflow live tracking', () => {
  it('emits task_started, live task_progress from task-*.log + child transcripts, and task_notification on completion', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-wf-1'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const tasksDir = join(brainRoot, parentSid, '.system_generated', 'tasks')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(tasksDir, { recursive: true })

    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const taskLogPath = join(tasksDir, 'task-6.log')
    const nowIso = new Date().toISOString()

    writeFileSync(
      taskLogPath,
      [
        '- [phase] Gather',
        '- [agent:self] Fact: apple: running (child-apple)',
      ].join('\n') + '\n',
      'utf8',
    )
    writeChildTranscript(brainRoot, 'child-apple', [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', content: 'Give a fact about apple' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 1000,
        output_tokens: 150,
        tool_calls: [{ id: 'tc-1', name: 'read_file', args: { Path: '/tmp/apple.txt' } }],
      },
      { step_index: 2, type: 'GENERIC', status: 'DONE', content: 'apple data' },
    ])

    const initialLines = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run workflow' }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{
          id: 'call_wf_6',
          name: 'run_workflow',
          args: {
            Description: 'Parallel fruit facts',
            Script: 'phase("Gather")\nphase("Summarize")',
          },
        }],
      }),
      JSON.stringify({
        step_index: 3,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-6\nTask logs are available at: file://${taskLogPath}`,
      }),
      JSON.stringify({ step_index: 4, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: 'Workflow started.' }),
    ]
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    const ackSummary = [
      `Tool is running as a background task with task id: ${parentSid}/task-6`,
      `Task logs are available at: file://${taskLogPath}`,
    ].join('\n')

    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wf-1',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wf-1',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_wf_6',
            toolName: 'Workflow',
            input: JSON.stringify({ Description: 'Parallel fruit facts', Script: 'phase("Gather")\nphase("Summarize")' }),
            status: 'complete',
          },
        },
        {
          type: 'content_delta',
          messageId: 'msg-wf-1',
          delta: {
            type: 'tool_result',
            toolUseId: 'call_wf_6',
            toolName: 'Workflow',
            summary: ackSummary,
            isError: false,
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'task_started',
      taskType: 'workflow',
      toolUseId: 'call_wf_6',
      taskId: `${parentSid}/task-6`,
      description: 'Parallel fruit facts',
      outputFile: taskLogPath,
      isBackgrounded: true,
    }))

    const firstProgress = emitted.find((e) => e.type === 'task_progress')
    expect(firstProgress).toMatchObject({
      type: 'task_progress',
      toolUseId: 'call_wf_6',
      taskId: `${parentSid}/task-6`,
      currentPhase: 'Gather',
      workflowPhases: [{ title: 'Gather', state: 'active' }],
      workflowAgents: [{
        agentId: 'child-apple',
        label: 'Fact: apple',
        toolCount: 1,
        tokens: 1150,
        state: 'running',
        phase: 'Gather',
      }],
      usage: {
        totalTokens: 1150,
        toolUses: 1,
      },
    })

    writeChildTranscript(brainRoot, 'child-apple', [
      { step_index: 0, type: 'USER_INPUT', status: 'DONE', content: 'Give a fact about apple' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 1000,
        output_tokens: 150,
        tool_calls: [{ id: 'tc-1', name: 'read_file', args: { Path: '/tmp/apple.txt' } }],
      },
      { step_index: 2, type: 'GENERIC', status: 'DONE', content: 'apple data' },
      {
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 1200,
        output_tokens: 200,
        tool_calls: [{ id: 'tc-2', name: 'finish', args: { Result: 'Apples are crisp.' } }],
      },
      { step_index: 4, type: 'GENERIC', status: 'DONE', content: 'Apples are crisp.' },
    ])
    writeFileSync(
      taskLogPath,
      [
        '- [phase] Gather',
        '- [agent:self] Fact: apple: running (child-apple)',
        '- [phase] Summarize',
        '- [agent:self] Merge: running (child-merge)',
      ].join('\n') + '\n',
      'utf8',
    )

    await new Promise((r) => setTimeout(r, 380))

    const progressEvents = emitted.filter((e) => e.type === 'task_progress')
    expect(progressEvents.length).toBeGreaterThanOrEqual(2)
    expect(progressEvents[progressEvents.length - 1]).toMatchObject({
      type: 'task_progress',
      currentPhase: 'Summarize',
      workflowPhases: [
        { title: 'Gather', state: 'done' },
        { title: 'Summarize', state: 'active' },
      ],
      workflowAgents: [
        expect.objectContaining({ agentId: 'child-apple', state: 'done', toolCount: 2, tokens: 2550 }),
        expect.objectContaining({ agentId: 'child-merge', state: 'running', phase: 'Summarize' }),
      ],
    })

    writeFileSync(
      taskLogPath,
      [
        '- [phase] Gather',
        '- [agent:self] Fact: apple: done (child-apple): "Apples are crisp."',
        '- [phase] Summarize',
        '- [agent:self] Merge: done (child-merge): "Summary ready."',
        'Output:',
        'All facts collected.',
      ].join('\n') + '\n',
      'utf8',
    )
    writeFileSync(
      transcriptPath,
      [
        ...initialLines,
        JSON.stringify({
          step_index: 5,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: nowIso,
          content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-6 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-6" finished with result:\nOutput:\nAll facts collected.\nLog: file://${taskLogPath}\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({
          step_index: 6,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          created_at: nowIso,
          content: 'Workflow finished.',
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    await vi.waitFor(() => {
      expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_wf_6')).toBe(true)
    })

    const notification = emitted.find((e) => e.type === 'task_notification' && e.toolUseId === 'call_wf_6')
    expect(notification).toMatchObject({
      type: 'task_notification',
      toolUseId: 'call_wf_6',
      taskId: `${parentSid}/task-6`,
      taskStatus: 'completed',
      outputFile: taskLogPath,
      summary: 'Parallel fruit facts',
      resultText: 'All facts collected.',
      currentPhase: 'Summarize',
      workflowPhases: [
        { title: 'Gather', state: 'done' },
        { title: 'Summarize', state: 'done' },
      ],
      workflowAgents: [
        expect.objectContaining({ agentId: 'child-apple', state: 'done', toolCount: 2, tokens: 2550 }),
        expect.objectContaining({ agentId: 'child-merge', state: 'done', phase: 'Summarize' }),
      ],
    })
  })

  it('ignores stale done tool_result after transcript binding and emits stopped on cancellation', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-wf-cancel'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const tasksDir = join(brainRoot, parentSid, '.system_generated', 'tasks')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(tasksDir, { recursive: true })

    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const taskLogPath = join(tasksDir, 'task-9.log')
    const nowIso = new Date().toISOString()

    writeFileSync(taskLogPath, '- [phase] Scan\n', 'utf8')
    const initialLines = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run scan' }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_wf_9', name: 'run_workflow', args: { Description: 'Scan repo' } }],
      }),
      JSON.stringify({
        step_index: 3,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-9\nTask logs are available at: file://${taskLogPath}`,
      }),
    ]
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wf-cancel',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wf-cancel',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_wf_9',
            toolName: 'Workflow',
            input: JSON.stringify({ Description: 'Scan repo' }),
            status: 'streaming',
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'task_started',
      taskType: 'workflow',
      toolUseId: 'call_wf_9',
      taskId: `${parentSid}/task-9`,
    }))

    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wf-cancel',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wf-cancel',
          delta: {
            type: 'tool_result',
            toolUseId: 'call_wf_9',
            toolName: 'Workflow',
            summary: 'done',
            isError: false,
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted.some((e) => e.type === 'task_notification')).toBe(false)

    writeFileSync(
      transcriptPath,
      [
        ...initialLines,
        JSON.stringify({
          step_index: 4,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: nowIso,
          content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${parentSid}/task-9 priority=MESSAGE_PRIORITY_HIGH content=Task id "${parentSid}/task-9" was canceled with result:\n\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({ step_index: 5, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: nowIso, content: 'Cancelled.' }),
      ].join('\n') + '\n',
      'utf8',
    )

    markAntigravityForegroundTurnEnded(parentSid)
    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'task_notification',
      toolUseId: 'call_wf_9',
      taskId: `${parentSid}/task-9`,
      taskStatus: 'stopped',
    }))
  })

  it('starts polling immediately on unbound Workflow tool_use and tracks multi-turn done, turn N agents', async () => {
    const brainRoot = makeTempBrainRoot()
    const parentSid = 'parent-wf-early-poll'
    const logsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
    const tasksDir = join(brainRoot, parentSid, '.system_generated', 'tasks')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(tasksDir, { recursive: true })

    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const taskLogPath = join(tasksDir, 'task-12.log')
    const nowIso = new Date().toISOString()

    const preLaunchLines = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Design brand' }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [{ id: 'call_wf_12', name: 'run_workflow', args: { Description: 'Brand workflow' } }],
      }),
    ]
    writeFileSync(transcriptPath, `${preLaunchLines.join('\n')}\n`, 'utf8')

    const emitted: AgentEvent[] = []
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-wf-12',
      [
        {
          type: 'content_delta',
          messageId: 'msg-wf-12',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_wf_12',
            toolName: 'Workflow',
            input: JSON.stringify({ Description: 'Brand workflow' }),
            status: 'streaming',
          },
        },
      ],
      (ev) => emitted.push(ev),
      [brainRoot],
    )

    expect(emitted).toHaveLength(0)

    writeFileSync(
      taskLogPath,
      [
        '- [phase] Critique',
        '- [agent:self] Brand Critic: done, turn 4 (35f91d8c-2448-4d63-b941-b874b92ee4b6): "赛博朋克茶室"',
      ].join('\n') + '\n',
      'utf8',
    )
    writeFileSync(
      transcriptPath,
      [
        ...preLaunchLines,
        JSON.stringify({
          step_index: 3,
          type: 'GENERIC',
          status: 'RUNNING',
          created_at: nowIso,
          content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${parentSid}/task-12\nTask logs are available at: file://${taskLogPath}`,
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    await new Promise((r) => setTimeout(r, 380))

    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'task_started',
      taskType: 'workflow',
      toolUseId: 'call_wf_12',
      taskId: `${parentSid}/task-12`,
      outputFile: taskLogPath,
    }))
    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'task_progress',
      toolUseId: 'call_wf_12',
      currentPhase: 'Critique',
      workflowAgents: [
        expect.objectContaining({
          agentId: '35f91d8c-2448-4d63-b941-b874b92ee4b6',
          label: 'Brand Critic',
          state: 'done',
          phase: 'Critique',
        }),
      ],
    }))
  })
})
