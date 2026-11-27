import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { MonitorSessionHold } from '@superone/shared/monitor-session-hold'
import {
  cancelAntigravitySubagentWakeupWait,
  disposeAntigravitySubagentTracker,
  markAntigravityForegroundTurnEnded,
  noteAntigravitySubagentEvents,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeBrainFixture(parentSid: string, subSids: string[]) {
  const brainRoot = mkdtempSync(join(tmpdir(), 'superone-agy-subagent-kill-'))
  tempDirs.push(brainRoot)
  const parentLogsDir = join(brainRoot, parentSid, '.system_generated', 'logs')
  mkdirSync(parentLogsDir, { recursive: true })
  const subPaths: Record<string, string> = {}
  for (const sid of subSids) {
    const dir = join(brainRoot, sid, '.system_generated', 'logs')
    mkdirSync(dir, { recursive: true })
    subPaths[sid] = join(dir, 'transcript.jsonl')
  }
  return {
    brainRoot,
    parentFullPath: join(parentLogsDir, 'transcript_full.jsonl'),
    subPaths,
  }
}

function writeJsonl(path: string, records: ReadonlyArray<Record<string, unknown>>): void {
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
}

function plannerCallsLine(
  stepIndex: number,
  iso: string,
  toolCalls: ReadonlyArray<{ id: string; name: string; args: Record<string, unknown> }>,
): Record<string, unknown> {
  return { step_index: stepIndex, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: iso, tool_calls: toolCalls }
}

function genericLine(stepIndex: number, iso: string, content: string, status = 'DONE'): Record<string, unknown> {
  return { step_index: stepIndex, type: 'GENERIC', status, created_at: iso, content }
}

function createdSubagentLine(stepIndex: number, iso: string, conversationId: string, logPath?: string): Record<string, unknown> {
  return genericLine(
    stepIndex,
    iso,
    `Created the following subagent:\n${JSON.stringify({
      conversationId,
      ...(logPath ? { logAbsoluteUri: `file://${logPath}` } : {}),
    })}`,
  )
}

function agentToolUse(messageId: string, toolUseId: string, input: Record<string, unknown> = {}): AgentEvent {
  return {
    type: 'content_delta',
    messageId,
    delta: { type: 'tool_use', toolUseId, toolName: 'Agent', input: JSON.stringify({ run_in_background: true, ...input }) },
  }
}

function createLifecycleObserver() {
  const hold = new MonitorSessionHold()
  const liveBackgroundTaskIds = new Set<string>()
  const emitted: AgentEvent[] = []

  const record = (event: AgentEvent) => {
    emitted.push(event)
    hold.note(event)
    if (event.type === 'task_started') {
      if (event.taskId) {
        if (event.toolUseId) liveBackgroundTaskIds.delete(`tool:${event.toolUseId}`)
        liveBackgroundTaskIds.add(event.taskId)
      } else if (event.toolUseId) {
        liveBackgroundTaskIds.add(`tool:${event.toolUseId}`)
      }
      return
    }
    if (event.type === 'task_progress') {
      if (event.taskId) liveBackgroundTaskIds.add(event.taskId)
      return
    }
    if (event.type === 'task_notification') {
      const status = event.taskStatus
      if (status === 'completed' || status === 'stopped' || status === 'failed') {
        if (event.taskId) liveBackgroundTaskIds.delete(event.taskId)
        if (event.toolUseId) liveBackgroundTaskIds.delete(`tool:${event.toolUseId}`)
      }
      return
    }
    if (event.type === 'content_delta' && event.delta.type === 'tool_result') {
      try {
        const parsed = JSON.parse(event.delta.summary) as Record<string, unknown>
        if (typeof parsed.subagent_id === 'string' && parsed.subagent_id) {
          liveBackgroundTaskIds.add(parsed.subagent_id)
        }
      } catch {
        void 0
      }
    }
  }

  return { hold, liveBackgroundTaskIds, emitted, record }
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity subagent and background task termination (#214)', () => {
  it('releases MonitorSessionHold and liveBackgroundTaskIds when a subagent is killed via manage_subagents', async () => {
    const parentSid = '4ec9c100-0000-4000-8000-000000000214'
    const subSid = 'a9383a2e-0000-4000-8000-000000000214'
    const iso = new Date().toISOString()
    const { brainRoot, parentFullPath, subPaths } = makeBrainFixture(parentSid, [subSid])

    writeJsonl(subPaths[subSid]!, [
      { step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Implement phase 1' },
      plannerCallsLine(2, iso, [{ id: 'rf_1', name: 'read_file', args: { Path: '/tmp/a.ts' } }]),
      genericLine(3, iso, 'file contents'),
    ])

    const initialParent = [
      { step_index: 176, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Start work' },
      plannerCallsLine(177, iso, [{ id: 'call_sub_kill_1', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'Implementer', Prompt: 'Implement' } }]),
      createdSubagentLine(178, iso, subSid, subPaths[subSid]),
    ]
    writeJsonl(parentFullPath, initialParent)

    const { hold, liveBackgroundTaskIds, emitted, record } = createLifecycleObserver()
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-kill-1',
      [agentToolUse('msg-kill-1', 'call_sub_kill_1', { subagent_type: 'self', description: 'Implementer' })],
      record,
      [brainRoot],
    )

    expect([...liveBackgroundTaskIds]).toEqual([subSid])
    expect(hold.adjust({ type: 'status_change', status: 'idle' })).toEqual({ type: 'status_change', status: 'background' })

    writeJsonl(parentFullPath, [
      ...initialParent,
      plannerCallsLine(188, iso, [{ id: 'call_kill_188', name: 'manage_subagents', args: { Action: 'kill', ConversationIds: JSON.stringify([subSid]) } }]),
      genericLine(190, iso, 'Successfully killed 1 subagent(s) and their descendants.\nKilled roles: Implementer'),
    ])

    await vi.waitFor(() => {
      expect([...liveBackgroundTaskIds]).toEqual([])
    })
    expect(
      emitted.some((e) => e.type === 'task_notification' && e.taskId === subSid && e.toolUseId === 'call_sub_kill_1' && e.taskStatus === 'stopped'),
    ).toBe(true)
    expect(hold.followUp()).toEqual({ type: 'status_change', status: 'idle' })
    expect(hold.adjust({ type: 'status_change', status: 'idle' })).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('emits stopped task_notification for bound and unbound subagents and background bash tasks on cancelAntigravitySubagentWakeupWait', () => {
    const parentSid = '4ec9c100-0000-4000-8000-000000000215'
    const subSid = 'a9383a2e-0000-4000-8000-000000000215'
    const bgTaskId = `${parentSid}/task-99`
    const iso = new Date().toISOString()
    const { brainRoot, parentFullPath, subPaths } = makeBrainFixture(parentSid, [subSid])

    writeJsonl(subPaths[subSid]!, [{ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Run' }])
    writeJsonl(parentFullPath, [
      { step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Run all' },
      plannerCallsLine(2, iso, [
        { id: 'call_sub_cancel', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'Worker', Prompt: 'Go' } },
        { id: 'call_bash_cancel', name: 'run_command', args: { CommandLine: 'sleep 30', WaitMsBeforeAsync: 500 } },
      ]),
      createdSubagentLine(3, iso, subSid, subPaths[subSid]),
      genericLine(4, iso, `Created At: ${iso}\nTool is running as a background task with task id: ${bgTaskId}`, 'RUNNING'),
    ])

    const { hold, liveBackgroundTaskIds, emitted, record } = createLifecycleObserver()
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-cancel-1',
      [
        agentToolUse('msg-cancel-1', 'call_sub_cancel', { subagent_type: 'self', description: 'Worker' }),
        agentToolUse('msg-cancel-1', 'call_swarm_unbound', { subagent_type: 'verifier', description: 'verifier', isSwarmWorker: true }),
        { type: 'content_delta', messageId: 'msg-cancel-1', delta: { type: 'tool_use', toolUseId: 'call_bash_cancel', toolName: 'Bash', input: JSON.stringify({ command: 'sleep 30' }) } },
        { type: 'content_delta', messageId: 'msg-cancel-1', delta: { type: 'tool_result', toolUseId: 'call_bash_cancel', summary: `Tool is running as a background task with task id: ${bgTaskId}`, isError: false } },
      ],
      record,
      [brainRoot],
    )

    expect(hold.adjust({ type: 'status_change', status: 'idle' })).toEqual({ type: 'status_change', status: 'background' })
    expect(liveBackgroundTaskIds.has(subSid)).toBe(true)
    expect(liveBackgroundTaskIds.has('tool:call_swarm_unbound')).toBe(true)
    expect(liveBackgroundTaskIds.has(bgTaskId)).toBe(true)

    cancelAntigravitySubagentWakeupWait(parentSid)

    expect(emitted.some((e) => e.type === 'task_notification' && e.taskId === subSid && e.taskStatus === 'stopped')).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_swarm_unbound' && e.taskStatus === 'stopped')).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.taskId === bgTaskId && e.taskStatus === 'stopped')).toBe(true)
    expect([...liveBackgroundTaskIds]).toEqual([])
    expect(hold.followUp()).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('releases MonitorSessionHold and drains tool:<id> when subagents are killed before binding or via kill_all and manage_task kill', () => {
    const parentSid = '4ec9c100-0000-4000-8000-000000000216'
    const sub1 = 'a9383a2e-0000-4000-8000-000000000216'
    const sub2 = 'b9383a2e-0000-4000-8000-000000000216'
    const bgTaskId = `${parentSid}/task-77`
    const iso = new Date().toISOString()
    const { brainRoot, parentFullPath, subPaths } = makeBrainFixture(parentSid, [sub1])

    writeJsonl(subPaths[sub1]!, [{ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Run' }])

    const initialParent = [
      { step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Start tasks' },
      plannerCallsLine(2, iso, [
        { id: 'call_sub_killall', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'Worker', Prompt: 'Go' } },
        { id: 'call_bash_kill', name: 'run_command', args: { CommandLine: 'sleep 60', WaitMsBeforeAsync: 500 } },
      ]),
      createdSubagentLine(3, iso, sub1, subPaths[sub1]),
      genericLine(4, iso, `Created At: ${iso}\nTool is running as a background task with task id: ${bgTaskId}`, 'RUNNING'),
    ]
    writeJsonl(parentFullPath, initialParent)

    const { hold, liveBackgroundTaskIds, emitted, record } = createLifecycleObserver()
    noteAntigravitySubagentEvents(
      parentSid,
      'msg-killall-1',
      [
        agentToolUse('msg-killall-1', 'call_sub_killall', { subagent_type: 'self', description: 'Worker' }),
        { type: 'content_delta', messageId: 'msg-killall-1', delta: { type: 'tool_use', toolUseId: 'call_bash_kill', toolName: 'Bash', input: JSON.stringify({ command: 'sleep 60' }) } },
      ],
      record,
      [brainRoot],
    )

    expect(hold.adjust({ type: 'status_change', status: 'idle' })).toEqual({ type: 'status_change', status: 'background' })

    writeJsonl(parentFullPath, [
      ...initialParent,
      plannerCallsLine(5, iso, [{ id: 'call_sub_prekilled', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'FastKill', Prompt: 'Quick' } }]),
      createdSubagentLine(6, iso, sub2),
      plannerCallsLine(7, iso, [
        { id: 'call_ms_killall', name: 'manage_subagents', args: { Action: 'kill_all' } },
        { id: 'call_mt_kill', name: 'manage_task', args: { Action: 'kill', TaskId: bgTaskId } },
      ]),
      genericLine(8, iso, 'Successfully killed 2 subagent(s) and their descendants.'),
      genericLine(9, iso, `Task "${bgTaskId}" cancelled.`),
    ])

    noteAntigravitySubagentEvents(
      parentSid,
      'msg-killall-1',
      [agentToolUse('msg-killall-1', 'call_sub_prekilled', { subagent_type: 'self', description: 'FastKill' })],
      record,
      [brainRoot],
    )

    expect(emitted.some((e) => e.type === 'task_notification' && e.taskId === sub1 && e.taskStatus === 'stopped')).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_sub_prekilled' && e.taskStatus === 'stopped')).toBe(true)
    expect(emitted.some((e) => e.type === 'task_notification' && e.taskId === bgTaskId && e.taskStatus === 'stopped')).toBe(true)
    expect([...liveBackgroundTaskIds]).toEqual([])
    expect(hold.followUp()).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('reconciles a subsequent turn kill after an earlier subagent completed normally, and handles swarm kill', async () => {
    const parentSid = '4ec9c100-0000-4000-8000-000000000217'
    const sub1 = 'a9383a2e-0000-4000-8000-000000000217'
    const sub2 = 'b9383a2e-0000-4000-8000-000000000217'
    const iso = new Date().toISOString()
    const { brainRoot, parentFullPath, subPaths } = makeBrainFixture(parentSid, [sub1, sub2])

    writeJsonl(subPaths[sub1]!, [
      { step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'A' },
      { step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: iso, content: 'Done A' },
    ])
    writeJsonl(subPaths[sub2]!, [genericLine(1, iso, 'in flight')])

    const turn1 = [
      { step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Turn 1' },
      plannerCallsLine(2, iso, [{ id: 'call_s1', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'A', Prompt: 'A' } }]),
      createdSubagentLine(3, iso, sub1, subPaths[sub1]),
      { step_index: 4, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: iso, content: 'Spawned A' },
      { step_index: 5, type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: iso, content: `<SYSTEM_MESSAGE>\nDone A\nsender=${sub1}\n</SYSTEM_MESSAGE>` },
      { step_index: 6, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: iso, content: 'A completed.' },
    ]
    writeJsonl(parentFullPath, turn1)

    const { liveBackgroundTaskIds, record } = createLifecycleObserver()
    noteAntigravitySubagentEvents(parentSid, 'msg-t1', [agentToolUse('msg-t1', 'call_s1')], record, [brainRoot])
    markAntigravityForegroundTurnEnded(parentSid)
    expect([...liveBackgroundTaskIds]).toEqual([])

    writeJsonl(parentFullPath, [
      ...turn1,
      { step_index: 10, type: 'USER_INPUT', status: 'DONE', created_at: iso, content: 'Turn 2' },
      plannerCallsLine(11, iso, [
        { id: 'call_s2', name: 'invoke_subagent', args: { TypeName: 'self', Role: 'B', Prompt: 'B' } },
        { id: 'call_sw1', name: 'swarm', args: { action: 'add', name: 'auditor', brief: 'Audit' } },
      ]),
      createdSubagentLine(12, iso, sub2, subPaths[sub2]),
      genericLine(13, iso, 'Added auditor to swarm.'),
      plannerCallsLine(14, iso, [
        { id: 'call_kill_s2', name: 'manage_subagents', args: { Action: 'kill_all' } },
        { id: 'call_kill_sw1', name: 'swarm', args: { action: 'kill', name: 'auditor' } },
      ]),
      genericLine(15, iso, 'No active subagents to kill.'),
      genericLine(16, iso, 'Killed worker auditor.'),
    ])

    noteAntigravitySubagentEvents(
      parentSid,
      'msg-t2',
      [
        agentToolUse('msg-t2', 'call_s2'),
        agentToolUse('msg-t2', 'call_sw1', { isSwarmWorker: true, subagent_type: 'auditor', name: 'auditor' }),
      ],
      record,
      [brainRoot],
    )

    expect([...liveBackgroundTaskIds]).toEqual([])
  })
})
