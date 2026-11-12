import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { isAlwaysHiddenToolName } from '@superone/shared/tool-ui'
import { describe, expect, it } from 'vitest'
import { mapSessionUpdate } from './acp-event-map'
import { normalizeAntigravitySessionUpdate } from './antigravity-protocol'

describe('Antigravity built-in system tool normalization and transcript backfill', () => {
  it('normalizes schedule, define_subagent, and send_message and resolves omitted completion outputs from transcript', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'agy-builtin-tools-'))
    try {
      const sessionId = '78438cf0-9ba3-45d6-8b4e-5716b251e54a'
      const logsDir = join(tmpRoot, sessionId, '.system_generated', 'logs')
      mkdirSync(logsDir, { recursive: true })

      const scheduleOut = [
        'Created At: 2026-11-12T08:00:00Z',
        'Tool is running as a background task with task id: 78438cf0-9ba3-45d6-8b4e-5716b251e54a/task-14',
        'Task Description: Timer: 1m 30s, Prompt: Check deployment health',
        'Task logs are available at: file:///tmp/task-14.log',
      ].join('\n')
      const defineOut = 'Created At: 2026-11-12T08:00:01Z\nSubagent "db-migrator" defined successfully. It can now be invoked via invoke_subagent.'
      const sendOut = 'Created At: 2026-11-12T08:00:02Z\nMessage sent to "c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d".'

      const lines = [
        JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', content: 'run orchestration' }),
        JSON.stringify({
          step_index: 2,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          tool_calls: [
            { id: 'tc_sched', name: 'schedule', args: { DurationSeconds: 90, Prompt: 'Check deployment health', TimerCondition: 'any' } },
            { id: 'tc_def', name: 'define_subagent', args: { Name: 'db-migrator', Description: 'Runs migrations', EnableWriteTools: true } },
            { id: 'tc_send', name: 'send_message', args: { Recipient: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d', Message: 'Proceed with step 2' } },
          ],
        }),
        JSON.stringify({ step_index: 3, type: 'GENERIC', status: 'DONE', content: scheduleOut }),
        JSON.stringify({ step_index: 4, type: 'GENERIC', status: 'DONE', content: defineOut }),
        JSON.stringify({ step_index: 5, type: 'GENERIC', status: 'DONE', content: sendOut }),
      ]
      writeFileSync(join(logsDir, 'transcript_full.jsonl'), `${lines.join('\n')}\n`, 'utf8')

      const startSchedule = normalizeAntigravitySessionUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_sched',
          title: 'Running schedule',
          kind: 'other',
          status: 'in_progress',
          rawInput: { DurationSeconds: 90, Prompt: 'Check deployment health', TimerCondition: 'any' },
        } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      expect(mapSessionUpdate(startSchedule, { messageId: 'm1' })).toEqual([
        {
          type: 'content_delta',
          messageId: 'm1',
          delta: {
            type: 'tool_use',
            toolUseId: 'tc_sched',
            toolName: 'Schedule',
            toolFilePath: undefined,
            toolSummary: undefined,
            input: JSON.stringify({
              prompt: 'Check deployment health',
              durationSeconds: 90,
              timerCondition: 'any',
            }),
            status: 'streaming',
          },
        },
      ])

      const doneSchedule = normalizeAntigravitySessionUpdate(
        { sessionUpdate: 'tool_call_update', toolCallId: 'tc_sched', status: 'completed' } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      const schedResult = mapSessionUpdate(doneSchedule, { messageId: 'm1' }).find(
        (e) => e.type === 'content_delta' && e.delta.type === 'tool_result',
      )
      expect(schedResult).toEqual({
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tc_sched',
          summary: scheduleOut.replace(/^Created At:[^\n]+\n/, ''),
          isError: false,
        },
      })

      const startDefine = normalizeAntigravitySessionUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_def',
          title: 'Running define_subagent',
          kind: 'other',
          status: 'in_progress',
          rawInput: { Name: 'db-migrator', Description: 'Runs migrations', EnableWriteTools: true },
        } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      expect(mapSessionUpdate(startDefine, { messageId: 'm1' })).toEqual([
        {
          type: 'content_delta',
          messageId: 'm1',
          delta: {
            type: 'tool_use',
            toolUseId: 'tc_def',
            toolName: 'DefineSubagent',
            toolFilePath: undefined,
            toolSummary: undefined,
            input: JSON.stringify({
              name: 'db-migrator',
              description: 'Runs migrations',
              enableWriteTools: true,
            }),
            status: 'streaming',
          },
        },
      ])

      const doneDefine = normalizeAntigravitySessionUpdate(
        { sessionUpdate: 'tool_call_update', toolCallId: 'tc_def', status: 'completed' } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      expect(mapSessionUpdate(doneDefine, { messageId: 'm1' })).toContainEqual({
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tc_def',
          summary: 'Subagent "db-migrator" defined successfully. It can now be invoked via invoke_subagent.',
          isError: false,
        },
      })

      const startSend = normalizeAntigravitySessionUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_send',
          title: 'Running send_message',
          kind: 'other',
          status: 'in_progress',
          rawInput: { Recipient: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d', Message: 'Proceed with step 2' },
        } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      expect(mapSessionUpdate(startSend, { messageId: 'm1' })).toEqual([
        {
          type: 'content_delta',
          messageId: 'm1',
          delta: {
            type: 'tool_use',
            toolUseId: 'tc_send',
            toolName: 'SendMessage',
            toolFilePath: undefined,
            toolSummary: undefined,
            input: JSON.stringify({
              to: 'c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d',
              message: 'Proceed with step 2',
            }),
            status: 'streaming',
          },
        },
      ])

      const doneSend = normalizeAntigravitySessionUpdate(
        { sessionUpdate: 'tool_call_update', toolCallId: 'tc_send', status: 'completed' } as unknown as SessionUpdate,
        sessionId,
        [tmpRoot],
      )
      expect(mapSessionUpdate(doneSend, { messageId: 'm1' })).toContainEqual({
        type: 'content_delta',
        messageId: 'm1',
        delta: {
          type: 'tool_result',
          toolUseId: 'tc_send',
          summary: 'Message sent to "c1a24e86-36c4-40e2-b1d8-6df9c7ddca9d".',
          isError: false,
        },
      })
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('maps list_resources, read_resource (including Resource "<uri>" title), and sparse call_mcp_tool frames accurately', () => {
    const sparseMcp = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_mcp_sparse',
      title: 'Running call_mcp_tool',
      kind: 'other',
      status: 'in_progress',
      rawInput: {},
    } as unknown as SessionUpdate)
    const sparseEvents = mapSessionUpdate(sparseMcp, { messageId: 'm2' })
    expect(sparseEvents).toEqual([])
    expect(isAlwaysHiddenToolName('call_mcp_tool')).toBe(true)
    expect(isAlwaysHiddenToolName('UseTool')).toBe(true)

    const listRes = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_list_res',
      title: 'Running list_resources',
      kind: 'other',
      status: 'in_progress',
      rawInput: { ServerName: 'context7' },
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(listRes, { messageId: 'm2' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm2',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_list_res',
          toolName: 'ListMcpResources',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ server: 'context7' }),
          status: 'streaming',
        },
      },
    ])

    const readResNativeTitle = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_read_res',
      title: 'Resource "mcp://context7/docs/react"',
      kind: 'read',
      status: 'in_progress',
      rawInput: { ServerName: 'context7', Uri: 'mcp://context7/docs/react' },
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(readResNativeTitle, { messageId: 'm2' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm2',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_read_res',
          toolName: 'ReadMcpResource',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ server: 'context7', uri: 'mcp://context7/docs/react' }),
          status: 'streaming',
        },
      },
    ])
  })

  it('correctly classifies agy native titles for read_url_content, command_status, send_command_input, notebook_edit, and wait_5_seconds', () => {
    const webUrlCall = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_url',
      title: 'URL https://example.com/docs',
      kind: 'read',
      status: 'in_progress',
      rawInput: { Url: 'https://example.com/docs' },
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(webUrlCall, { messageId: 'm3' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm3',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_url',
          toolName: 'WebFetch',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ url: 'https://example.com/docs' }),
          status: 'streaming',
        },
      },
    ])

    const cmdStatusCall = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_cmd_status',
      title: 'Waiting for command completion',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { CommandId: 'cmd-42', WaitDurationSeconds: 10 },
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(cmdStatusCall, { messageId: 'm3' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm3',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_cmd_status',
          toolName: 'TaskOutput',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ task_id: 'cmd-42' }),
          status: 'streaming',
        },
      },
    ])

    const sendCmdCall = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_send_cmd',
      title: 'Send "y\\n" to command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { CommandId: 'cmd-42', Input: 'y\n', Terminate: false },
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(sendCmdCall, { messageId: 'm3' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm3',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_send_cmd',
          toolName: 'ManageTask',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ action: 'send_input', taskId: 'cmd-42', input: 'y\n' }),
          status: 'streaming',
        },
      },
    ])

    const notebookCall = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_nb',
      title: 'Notebook /workspace/analysis.ipynb',
      kind: 'edit',
      status: 'in_progress',
      rawInput: { NotebookPath: '/workspace/analysis.ipynb' },
    } as unknown as SessionUpdate)
    const nbMapped = mapSessionUpdate(notebookCall, { messageId: 'm3' })
    const nbDelta = nbMapped[0] && 'delta' in nbMapped[0] ? nbMapped[0].delta : null
    expect(nbDelta && 'toolName' in nbDelta ? nbDelta.toolName : null).toBe('NotebookEdit')

    const waitCall = normalizeAntigravitySessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_wait',
      title: 'Running wait_5_seconds',
      kind: 'think',
      status: 'in_progress',
      rawInput: {},
    } as unknown as SessionUpdate)
    expect(mapSessionUpdate(waitCall, { messageId: 'm3' })).toEqual([
      {
        type: 'content_delta',
        messageId: 'm3',
        delta: {
          type: 'tool_use',
          toolUseId: 'tc_wait',
          toolName: 'Wait',
          toolFilePath: undefined,
          toolSummary: undefined,
          input: JSON.stringify({ durationSeconds: 5 }),
          status: 'streaming',
        },
      },
    ])
  })
})
