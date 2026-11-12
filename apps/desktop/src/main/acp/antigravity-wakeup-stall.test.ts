import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))
vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: vi.fn(() => []),
}))
vi.mock('../mcp/superone-mcp-server', () => ({
  isBuiltInSuperoneTool: () => false,
  isToolPreapproved: () => false,
}))
vi.mock('../mcp/config-tools', () => ({
  resolveConfigConfirm: () => false,
  rejectConfigConfirm: () => false,
  configApplyHandler: vi.fn(),
  configReadHandler: vi.fn(),
}))
vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpStdioArgs: () => null,
  setSuperoneMcpBridgeRuntime: vi.fn(),
}))

import { createAcpRuntime } from './acp-runtime'
import {
  disposeAntigravitySubagentTracker,
  extractCompletedBackgroundTasksFromTranscript,
} from './antigravity-subagent'

const tempDirs: string[] = []

function makeTempBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-stall-'))
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

describe('antigravity conditional schedule and stalled Ask-mode wakeup replay', () => {
  it('marks conditional schedule timers as low-priority completed when a matching SYSTEM_MESSAGE arrives', () => {
    const nowIso = new Date().toISOString()
    const raw = [
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run subagent' }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: nowIso,
        tool_calls: [
          { id: 'call_s_any', name: 'schedule', args: { DurationSeconds: 60, Prompt: 'Wait any', TimerCondition: 'any' } },
          { id: 'call_s_sender', name: 'schedule', args: { DurationSeconds: 60, Prompt: 'Wait sub', TimerCondition: 'sub-42' } },
          { id: 'call_s_never', name: 'schedule', args: { DurationSeconds: 60, Prompt: 'Wait never', TimerCondition: 'never' } },
        ],
      }),
      JSON.stringify({
        step_index: 3,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: sess/task-3`,
      }),
      JSON.stringify({
        step_index: 4,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: sess/task-4`,
      }),
      JSON.stringify({
        step_index: 5,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: nowIso,
        content: `Created At: ${nowIso}\nTool is running as a background task with task id: sess/task-5`,
      }),
      JSON.stringify({
        step_index: 6,
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        created_at: nowIso,
        content: `<SYSTEM_MESSAGE>\n[Message]\nSubagent done.\nsender=sub-42\n</SYSTEM_MESSAGE>`,
      }),
    ].join('\n')

    const completed = extractCompletedBackgroundTasksFromTranscript(raw, 1)
    expect(completed.get('sess/task-3')?.priority).toBe('low')
    expect(completed.get('sess/task-3')?.canceled).toBe(true)
    expect(completed.get('sess/task-4')?.priority).toBe('low')
    expect(completed.get('sess/task-4')?.canceled).toBe(true)
    expect(completed.has('sess/task-5')).toBe(false)
  })

  it('settles conditional schedule + stalled Ask-mode wakeup tool promptly and replays only unexecuted wakeup work on next prompt', async () => {
    const brainRoot = makeTempBrainRoot()
    const prevHome = process.env.SUPERONE_HOME
    process.env.SUPERONE_HOME = brainRoot

    const sessionId = 'agy-rt-session-stall'
    const logsDir = join(brainRoot, 'antigravity', 'profile', 'brain', sessionId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(join(brainRoot, 'antigravity'), { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    let promptTurnCount = 0
    let permissionRequestedFor: string | null = null

    const makeStream = (): { stream: Stream; dispose: () => void } => {
      const app = agent({ name: 'mock-agy-stall' })
        .onRequest(methods.agent.initialize, async () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {},
        }))
        .onRequest(methods.agent.authenticate, async () => ({}))
        .onRequest(methods.agent.session.new, async () => ({ sessionId }))
        .onRequest(methods.agent.session.setMode, async () => ({}))
        .onRequest(methods.agent.session.prompt, async (ctx) => {
          promptTurnCount += 1
          if (promptTurnCount === 1) {
            const initialTranscript = [
              JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run check with timer' }),
              JSON.stringify({
                step_index: 2,
                type: 'PLANNER_RESPONSE',
                status: 'DONE',
                created_at: nowIso,
                tool_calls: [
                  { id: 'call_bg_work', name: 'run_command', args: { CommandLine: 'sleep 1 && echo ready', WaitMsBeforeAsync: 500 } },
                  { id: 'call_sched_cond', name: 'schedule', args: { DurationSeconds: 600, Prompt: 'Fallback timeout', TimerCondition: 'any' } },
                ],
              }),
              JSON.stringify({
                step_index: 3,
                type: 'GENERIC',
                status: 'RUNNING',
                created_at: nowIso,
                content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${sessionId}/task-3`,
              }),
              JSON.stringify({
                step_index: 4,
                type: 'GENERIC',
                status: 'RUNNING',
                created_at: nowIso,
                content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${sessionId}/task-4`,
              }),
              JSON.stringify({
                step_index: 5,
                type: 'PLANNER_RESPONSE',
                status: 'DONE',
                created_at: nowIso,
                content: '已启动后台任务与条件定时器。',
              }),
            ]
            writeFileSync(transcriptPath, `${initialTranscript.join('\n')}\n`, 'utf8')

            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Run check with timer' } },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call_bg_work',
                title: 'Run command',
                kind: 'execute',
                status: 'in_progress',
                rawInput: { CommandLine: 'sleep 1 && echo ready', WaitMsBeforeAsync: 500 },
              },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call_sched_cond',
                title: 'schedule',
                kind: 'other',
                status: 'completed',
                rawInput: { DurationSeconds: 600, Prompt: 'Fallback timeout', TimerCondition: 'any' },
              },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已启动后台任务与条件定时器。' } },
            })

            setTimeout(() => {
              writeFileSync(
                transcriptPath,
                [
                  ...initialTranscript,
                  JSON.stringify({
                    step_index: 6,
                    type: 'SYSTEM_MESSAGE',
                    status: 'DONE',
                    created_at: nowIso,
                    content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${sessionId}/task-3 priority=MESSAGE_PRIORITY_HIGH content=Task id "${sessionId}/task-3" finished with result:\nCommand exited with code 0.\n\nCommand output:\nready\n</SYSTEM_MESSAGE>`,
                  }),
                  JSON.stringify({
                    step_index: 7,
                    type: 'PLANNER_RESPONSE',
                    status: 'DONE',
                    created_at: nowIso,
                    thinking: 'Writing output report.',
                    content: '准备写入报告文件。',
                    tool_calls: [{ id: 'call_wakeup_write', name: 'write_file', args: { Path: '/etc/report.txt', Content: 'ready' } }],
                  }),
                ].join('\n') + '\n',
                'utf8',
              )
            }, 60)

            return { stopReason: 'end_turn' }
          }

          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'call_bg_work',
              title: 'Run command',
              kind: 'execute',
              status: 'completed',
              rawInput: { CommandLine: 'sleep 1 && echo ready' },
              rawOutput: 'Command exited with code 0.\n\nCommand output:\nready',
            },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Writing output report.' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '准备写入报告文件。' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'call_wakeup_write',
              title: 'Write file',
              kind: 'edit',
              status: 'pending',
              rawInput: { Path: '/etc/report.txt', Content: 'ready' },
            },
          })
          await ctx.client.request(methods.client.session.requestPermission, {
            sessionId,
            toolCall: {
              toolCallId: 'call_wakeup_write',
              title: 'Write file',
              kind: 'edit',
              rawInput: { Path: '/etc/report.txt', Content: 'ready' },
            },
            options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }],
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'call_wakeup_write',
              status: 'completed',
              rawOutput: 'Wrote /etc/report.txt',
            },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '报告已写入完成。' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Continue' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '第二轮继续完成。' } },
          })
          return { stopReason: 'end_turn' }
        })

      const c2a = new TransformStream<Uint8Array>()
      const a2c = new TransformStream<Uint8Array>()
      app.connect(ndJsonStream(a2c.writable, c2a.readable))
      return {
        stream: ndJsonStream(c2a.writable, a2c.readable),
        dispose: () => {
          try { if (!c2a.writable.locked) void c2a.writable.close().catch(() => undefined) } catch { void 0 }
          try { if (!a2c.writable.locked) void a2c.writable.close().catch(() => undefined) } catch { void 0 }
        },
      }
    }

    writeFileSync(
      join(brainRoot, 'antigravity', 'auth-config.json'),
      JSON.stringify({ authMethod: 'oauth-personal', oauthSignedIn: true }),
      'utf8',
    )

    try {
      const runtime = await createAcpRuntime({
        launch: {
          agentId: 'antigravity',
          command: 'agy',
          defaultCwd: '/tmp',
        },
        permissionMode: 'default',
        permission: {
          request: async (params) => {
            permissionRequestedFor = params.toolCall.toolCallId
            return { outcome: { outcome: 'selected', optionId: 'allow_once' } }
          },
        },
        streamFactory: async () => makeStream(),
      })

      const turn1Events: AgentEvent[] = []
      const startedAt = Date.now()
      await runtime.prompt('Run check with timer', 'msg-stall-1', (ev) => turn1Events.push(ev))
      expect(Date.now() - startedAt).toBeLessThan(4_000)

      expect(
        turn1Events.some(
          (e) =>
            e.type === 'content_delta' &&
            e.delta.type === 'tool_use' &&
            e.delta.toolUseId === 'call_wakeup_write',
        ),
      ).toBe(false)
      expect(
        turn1Events.some(
          (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '准备写入报告文件。',
        ),
      ).toBe(true)

      const turn2Events: AgentEvent[] = []
      await runtime.prompt('Continue', 'msg-stall-2', (ev) => turn2Events.push(ev))

      expect(permissionRequestedFor).toBe('call_wakeup_write')
      expect(
        turn2Events.some(
          (e) =>
            e.type === 'content_delta' &&
            (e.delta.type === 'tool_use' || e.delta.type === 'tool_result') &&
            e.delta.toolUseId === 'call_bg_work',
        ),
      ).toBe(false)
      expect(
        turn2Events.some(
          (e) =>
            e.type === 'content_delta' &&
            e.delta.type === 'tool_result' &&
            e.delta.toolUseId === 'call_wakeup_write',
        ),
      ).toBe(true)
      const turn2Text = turn2Events
        .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
        .filter((e) => e.delta.type === 'text')
        .map((e) => (e.delta as { text: string }).text)
        .join('')
      expect(turn2Text).toBe('报告已写入完成。第二轮继续完成。')

      await runtime.close()
    } finally {
      if (prevHome === undefined) delete process.env.SUPERONE_HOME
      else process.env.SUPERONE_HOME = prevHome
    }
  })
})
