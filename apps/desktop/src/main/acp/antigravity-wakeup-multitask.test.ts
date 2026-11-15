import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestContext,
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
import { disposeAntigravitySubagentTracker } from './antigravity-subagent'

const tempDirs: string[] = []

function setupAntigravityTestHome(sessionId: string): {
  transcriptPath: string
  restoreHome: () => void
} {
  const brainRoot = mkdtempSync(join(tmpdir(), 'superone-agy-multitask-'))
  tempDirs.push(brainRoot)
  const prevHome = process.env.SUPERONE_HOME
  process.env.SUPERONE_HOME = brainRoot
  const logsDir = join(brainRoot, 'antigravity', 'profile', 'brain', sessionId, '.system_generated', 'logs')
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(
    join(brainRoot, 'antigravity', 'auth-config.json'),
    JSON.stringify({ authMethod: 'oauth-personal', oauthSignedIn: true }),
    'utf8',
  )
  return {
    transcriptPath: join(logsDir, 'transcript_full.jsonl'),
    restoreHome: () => {
      if (prevHome === undefined) delete process.env.SUPERONE_HOME
      else process.env.SUPERONE_HOME = prevHome
    },
  }
}

function connectMockAgent(app: ReturnType<typeof agent>): { stream: Stream; dispose: () => void } {
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

function writeTranscript(transcriptPath: string, lines: string[]): void {
  writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf8')
}

function userStep(stepIndex: number, content: string, nowIso: string): string {
  return JSON.stringify({ step_index: stepIndex, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content })
}

function plannerStep(
  stepIndex: number,
  nowIso: string,
  fields: { content?: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> },
): string {
  return JSON.stringify({
    step_index: stepIndex,
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: nowIso,
    ...(fields.content !== undefined ? { content: fields.content } : {}),
    ...(fields.toolCalls ? { tool_calls: fields.toolCalls } : {}),
  })
}

function bgRunningStep(stepIndex: number, taskId: string, nowIso: string): string {
  return JSON.stringify({
    step_index: stepIndex,
    type: 'GENERIC',
    status: 'RUNNING',
    created_at: nowIso,
    content: `Created At: ${nowIso}\nTool is running as a background task with task id: ${taskId}`,
  })
}

function bgFinishedSystemStep(stepIndex: number, taskId: string, output: string, nowIso: string): string {
  return JSON.stringify({
    step_index: stepIndex,
    type: 'SYSTEM_MESSAGE',
    status: 'DONE',
    created_at: nowIso,
    content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${taskId} priority=MESSAGE_PRIORITY_HIGH content=Task id "${taskId}" finished with result:\nCommand exited with code 0.\n\nCommand output:\n${output}\n</SYSTEM_MESSAGE>`,
  })
}

function createMockAgyAgent(
  sessionId: string,
  onPrompt: (ctx: RequestContext) => Promise<{ stopReason: 'end_turn' }>,
): ReturnType<typeof agent> {
  return agent({ name: 'mock-agy' })
    .onRequest(methods.agent.initialize, async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest(methods.agent.authenticate, async () => ({}))
    .onRequest(methods.agent.session.new, async () => ({ sessionId }))
    .onRequest(methods.agent.session.setMode, async () => ({}))
    .onRequest(methods.agent.session.prompt, onPrompt)
}

async function notifyForegroundTurn(
  ctx: RequestContext,
  sessionId: string,
  userText: string,
  toolCalls: Array<{ id: string; cmd: string }>,
  replyText: string,
  completedTools: Array<{ id: string; output: string }> = [],
): Promise<void> {
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: userText } },
  })
  for (const tc of toolCalls) {
    await ctx.client.notify(methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: tc.id,
        title: 'Run command',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { CommandLine: tc.cmd, WaitMsBeforeAsync: 1000 },
      },
    })
  }
  for (const done of completedTools) {
    await ctx.client.notify(methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: done.id,
        status: 'completed',
        rawOutput: done.output,
      },
    })
  }
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: replyText } },
  })
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('antigravity multi-wave and tool-executing background wakeups', () => {
  it('waits across a wakeup tool execution instead of prematurely closing the wakeup watch', async () => {
    const sessionId = 'agy-multi-tool-1'
    const { transcriptPath, restoreHome } = setupAntigravityTestHome(sessionId)
    const nowIso = new Date().toISOString()

    const initialLines = [
      userStep(1, 'Run check', nowIso),
      plannerStep(2, nowIso, {
        toolCalls: [{ id: 'call_bg_1', name: 'run_command', args: { CommandLine: 'bun test', WaitMsBeforeAsync: 5000 } }],
      }),
      bgRunningStep(3, `${sessionId}/task-3`, nowIso),
      plannerStep(4, nowIso, { content: '正在后台运行测试。' }),
    ]

    const app = createMockAgyAgent(sessionId, async (ctx) => {
      writeTranscript(transcriptPath, initialLines)
      await notifyForegroundTurn(ctx, sessionId, 'Run check', [{ id: 'call_bg_1', cmd: 'bun test' }], '正在后台运行测试。')

      const wakeupPendingToolLines = [
        ...initialLines,
        bgFinishedSystemStep(5, `${sessionId}/task-3`, '12 passed', nowIso),
        plannerStep(6, nowIso, {
          content: '测试已完成，正在读取报告文件。',
          toolCalls: [{ id: 'call_wake_read_1', name: 'read_file', args: { Path: '/tmp/report.json' } }],
        }),
      ]

      setTimeout(() => writeTranscript(transcriptPath, wakeupPendingToolLines), 60)
      setTimeout(() => {
        writeTranscript(transcriptPath, [
          ...wakeupPendingToolLines,
          JSON.stringify({
            step_index: 7,
            type: 'GENERIC',
            status: 'DONE',
            created_at: nowIso,
            content: `Created At: ${nowIso}\nCompleted At: ${nowIso}\n{"ok":true}`,
          }),
          plannerStep(8, nowIso, { content: '报告读取完毕，所有指标正常。' }),
        ])
      }, 550)

      return { stopReason: 'end_turn' }
    })

    try {
      const wakeEvents: AgentEvent[] = []
      const runtime = await createAcpRuntime({
        launch: { agentId: 'antigravity', command: 'agy', defaultCwd: '/tmp' },
        permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
        onSessionEvent: (ev) => wakeEvents.push(ev),
        streamFactory: async () => connectMockAgent(app),
      })

      await runtime.prompt('Run check', 'msg-1', () => undefined)

      await vi.waitFor(() => {
        expect(
          wakeEvents.some(
            (e) => e.type === 'content_delta' && e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_wake_read_1',
          ),
        ).toBe(true)
        expect(
          wakeEvents.some(
            (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '报告读取完毕，所有指标正常。',
          ),
        ).toBe(true)
        expect(wakeEvents.some((e) => e.type === 'message_complete')).toBe(true)
      }, { timeout: 4_000 })

      await runtime.close()
    } finally {
      restoreHome()
    }
  })

  it('tracks wakeup-spawned background tasks across waves and across a follow-up user prompt', async () => {
    const sessionId = 'agy-multi-wave-2'
    const { transcriptPath, restoreHome } = setupAntigravityTestHome(sessionId)
    const nowIso = new Date().toISOString()

    let currentLines: string[] = []
    let turnNumber = 0

    const app = createMockAgyAgent(sessionId, async (ctx) => {
      turnNumber += 1
      if (turnNumber === 1) {
        currentLines = [
          userStep(1, 'Deploy', nowIso),
          plannerStep(2, nowIso, {
            toolCalls: [{ id: 'call_wave1_bg', name: 'run_command', args: { CommandLine: 'step1.sh', WaitMsBeforeAsync: 1000 } }],
          }),
          bgRunningStep(3, `${sessionId}/task-3`, nowIso),
          plannerStep(4, nowIso, { content: '阶段一已启动。' }),
        ]
        writeTranscript(transcriptPath, currentLines)
        await notifyForegroundTurn(ctx, sessionId, 'Deploy', [{ id: 'call_wave1_bg', cmd: 'step1.sh' }], '阶段一已启动。')

        setTimeout(() => {
          currentLines = [
            ...currentLines,
            bgFinishedSystemStep(5, `${sessionId}/task-3`, 'step1 ok', nowIso),
            plannerStep(6, nowIso, {
              content: '阶段一完成，继续启动阶段二后台任务。',
              toolCalls: [{ id: 'call_wave2_bg', name: 'run_command', args: { CommandLine: 'step2.sh', WaitMsBeforeAsync: 1000, toolSummary: 'Step 2 deploy' } }],
            }),
            bgRunningStep(7, `${sessionId}/task-7`, nowIso),
            plannerStep(8, nowIso, { content: '阶段二正在后台执行。' }),
          ]
          writeTranscript(transcriptPath, currentLines)
        }, 60)

        return { stopReason: 'end_turn' }
      }

      currentLines = [
        ...currentLines,
        userStep(9, '?', nowIso),
        plannerStep(10, nowIso, { content: '阶段二仍在运行中，请稍候。' }),
      ]
      writeTranscript(transcriptPath, currentLines)
      await notifyForegroundTurn(ctx, sessionId, '?', [], '阶段二仍在运行中，请稍候。')

      setTimeout(() => {
        currentLines = [
          ...currentLines,
          bgFinishedSystemStep(11, `${sessionId}/task-7`, 'step2 ok', nowIso),
          plannerStep(12, nowIso, { content: '阶段二后台任务已全部完成！' }),
        ]
        writeTranscript(transcriptPath, currentLines)
      }, 80)

      return { stopReason: 'end_turn' }
    })

    try {
      const wakeEvents: AgentEvent[] = []
      const runtime = await createAcpRuntime({
        launch: { agentId: 'antigravity', command: 'agy', defaultCwd: '/tmp' },
        permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
        onSessionEvent: (ev) => wakeEvents.push(ev),
        streamFactory: async () => connectMockAgent(app),
      })

      await runtime.prompt('Deploy', 'msg-turn-1', () => undefined)

      await vi.waitFor(() => {
        expect(wakeEvents.some((e) => e.type === 'task_started' && e.taskId === `${sessionId}/task-7`)).toBe(true)
        expect(
          wakeEvents.some(
            (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '阶段二正在后台执行。',
          ),
        ).toBe(true)
      }, { timeout: 3_000 })

      const wave1WakeBubbleId = wakeEvents.find(
        (e): e is Extract<AgentEvent, { type: 'content_delta' }> =>
          e.type === 'content_delta' && e.delta.type === 'tool_use' && e.delta.toolUseId === 'call_wave2_bg',
      )?.messageId
      expect(wave1WakeBubbleId).toBeTruthy()

      const turn2Events: AgentEvent[] = []
      await runtime.prompt('?', 'msg-turn-2', (ev) => turn2Events.push(ev))
      expect(
        turn2Events.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '阶段二仍在运行中，请稍候。'),
      ).toBe(true)

      await vi.waitFor(() => {
        const wave2Result = wakeEvents.find(
          (e): e is Extract<AgentEvent, { type: 'content_delta' }> =>
            e.type === 'content_delta' && e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_wave2_bg',
        )
        expect(wave2Result?.messageId).toBe(wave1WakeBubbleId)

        const finalText = wakeEvents.find(
          (e): e is Extract<AgentEvent, { type: 'content_delta' }> =>
            e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '阶段二后台任务已全部完成！',
        )
        expect(finalText).toBeDefined()
        expect(finalText?.messageId).not.toBe(wave1WakeBubbleId)
        expect(wakeEvents.some((e) => e.type === 'message_complete' && e.messageId === finalText?.messageId)).toBe(true)
      }, { timeout: 4_000 })

      await runtime.close()
    } finally {
      restoreHome()
    }
  })

  it('does not re-emit a mid-turn completed background task when another task stays running', async () => {
    const sessionId = 'agy-midturn-reconcile-3'
    const { transcriptPath, restoreHome } = setupAntigravityTestHome(sessionId)
    const nowIso = new Date().toISOString()

    const app = createMockAgyAgent(sessionId, async (ctx) => {
      const turnEndLines = [
        userStep(1, 'Run both', nowIso),
        plannerStep(2, nowIso, {
          toolCalls: [
            { id: 'call_fast', name: 'run_command', args: { CommandLine: 'fast.sh', WaitMsBeforeAsync: 500 } },
            { id: 'call_slow', name: 'run_command', args: { CommandLine: 'slow.sh', WaitMsBeforeAsync: 500 } },
          ],
        }),
        bgRunningStep(3, `${sessionId}/task-3`, nowIso),
        bgRunningStep(4, `${sessionId}/task-4`, nowIso),
        bgFinishedSystemStep(5, `${sessionId}/task-3`, 'fast done', nowIso),
        plannerStep(6, nowIso, { content: '前台已流式输出快速任务结果，慢速任务仍在后台运行。' }),
      ]
      writeTranscript(transcriptPath, turnEndLines)
      await notifyForegroundTurn(
        ctx,
        sessionId,
        'Run both',
        [{ id: 'call_fast', cmd: 'fast.sh' }, { id: 'call_slow', cmd: 'slow.sh' }],
        '前台已流式输出快速任务结果，慢速任务仍在后台运行。',
        [{ id: 'call_fast', output: 'Command exited with code 0.\n\nCommand output:\nfast done' }],
      )

      setTimeout(() => {
        writeTranscript(transcriptPath, [
          ...turnEndLines,
          bgFinishedSystemStep(7, `${sessionId}/task-4`, 'slow done', nowIso),
          plannerStep(8, nowIso, { content: '慢速任务后台已完成。' }),
        ])
      }, 80)

      return { stopReason: 'end_turn' }
    })

    try {
      const wakeEvents: AgentEvent[] = []
      const runtime = await createAcpRuntime({
        launch: { agentId: 'antigravity', command: 'agy', defaultCwd: '/tmp' },
        permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
        onSessionEvent: (ev) => wakeEvents.push(ev),
        streamFactory: async () => connectMockAgent(app),
      })

      await runtime.prompt('Run both', 'msg-both', () => undefined)

      await vi.waitFor(() => {
        expect(
          wakeEvents.some(
            (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '慢速任务后台已完成。',
          ),
        ).toBe(true)
      }, { timeout: 3_000 })

      expect(
        wakeEvents.some(
          (e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '前台已流式输出快速任务结果，慢速任务仍在后台运行。',
        ),
      ).toBe(false)

      await runtime.close()
    } finally {
      restoreHome()
    }
  })
})
