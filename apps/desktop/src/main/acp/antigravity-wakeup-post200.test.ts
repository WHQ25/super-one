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
import { normalizeTranscriptTool } from '@superone/shared/tool-ui'

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
  getSuperoneMcpStdioConfig: () => null,
  setSuperoneMcpBridgeRuntime: vi.fn(),
}))

import { createAcpRuntime } from './acp-runtime'
import {
  disposeAntigravitySubagentTracker,
  extractParentWakeupProgress,
  noteAntigravitySubagentEvents,
  waitForAntigravitySubagentWakeup,
} from './antigravity-subagent'
import { resolveWakeupStallTimeoutMs } from './antigravity-wakeup-emitter'

const tempDirs: string[] = []

function setupBrainHome(sessionId: string): {
  brainRoot: string
  transcriptPath: string
  restoreHome: () => void
} {
  const home = mkdtempSync(join(tmpdir(), 'superone-agy-204-'))
  tempDirs.push(home)
  const prevHome = process.env.SUPERONE_HOME
  process.env.SUPERONE_HOME = home
  const brainRoot = join(home, 'antigravity', 'profile', 'brain')
  const logsDir = join(brainRoot, sessionId, '.system_generated', 'logs')
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(
    join(home, 'antigravity', 'auth-config.json'),
    JSON.stringify({ authMethod: 'oauth-personal', oauthSignedIn: true }),
    'utf8',
  )
  return {
    brainRoot,
    transcriptPath: join(logsDir, 'transcript_full.jsonl'),
    restoreHome: () => {
      if (prevHome === undefined) delete process.env.SUPERONE_HOME
      else process.env.SUPERONE_HOME = prevHome
    },
  }
}

function connectAgent(app: ReturnType<typeof agent>): { stream: Stream; dispose: () => void } {
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

function writeLines(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}

function userLine(idx: number, content: string, iso: string): string {
  return JSON.stringify({ step_index: idx, type: 'USER_INPUT', status: 'DONE', created_at: iso, content })
}

function plannerLine(
  idx: number,
  iso: string,
  opts: { content?: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> },
): string {
  return JSON.stringify({
    step_index: idx,
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: iso,
    ...(opts.content !== undefined ? { content: opts.content } : {}),
    ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}),
  })
}

function genericLine(idx: number, status: 'RUNNING' | 'DONE', content: string, iso: string): string {
  return JSON.stringify({ step_index: idx, type: 'GENERIC', status, created_at: iso, content })
}

function systemTaskLine(idx: number, taskId: string, output: string, iso: string): string {
  return JSON.stringify({
    step_index: idx,
    type: 'SYSTEM_MESSAGE',
    status: 'DONE',
    created_at: iso,
    content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${iso} sender=${taskId} priority=MESSAGE_PRIORITY_HIGH content=Task id "${taskId}" finished with result:\nCommand exited with code 0.\n\nCommand output:\n${output}\n</SYSTEM_MESSAGE>`,
  })
}

async function notifyBgForegroundTurn(
  ctx: RequestContext,
  sessionId: string,
  userText: string,
  toolCallId: string,
  cmd: string,
  replyText: string,
): Promise<void> {
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: userText } },
  })
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Run command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { CommandLine: cmd, WaitMsBeforeAsync: 500 },
    },
  })
  await ctx.client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: replyText } },
  })
}

function createMockAgent(
  sessionId: string,
  onPrompt: (ctx: RequestContext) => Promise<{ stopReason: 'end_turn' }>,
): ReturnType<typeof agent> {
  return agent({ name: 'mock-agy-204' })
    .onRequest(methods.agent.initialize, async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest(methods.agent.authenticate, async () => ({}))
    .onRequest(methods.agent.session.new, async () => ({ sessionId }))
    .onRequest(methods.agent.session.setMode, async () => ({}))
    .onRequest(methods.agent.session.prompt, onPrompt)
}

afterEach(() => {
  disposeAntigravitySubagentTracker()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Antigravity post-#200 wakeup regressions (#204)', () => {
  it('classifies MCP tools, acceptEdits file mutations, swarm, and BypassSandbox commands accurately', () => {
    const iso = new Date().toISOString()
    const makeWakeup = (toolName: string, args: Record<string, unknown> = {}) =>
      extractParentWakeupProgress(
        [
          userLine(1, 'go', iso),
          systemTaskLine(2, 'sess/task-1', 'ok', iso),
          plannerLine(3, iso, { toolCalls: [{ id: 'c1', name: toolName, args }] }),
        ].join('\n'),
        1,
      )

    const mcpWake = makeWakeup('call_mcp_tool', { ServerName: 'superone-alpha', ToolName: 'widget_show', Arguments: '{}' })
    expect(resolveWakeupStallTimeoutMs(mcpWake, 'standard', 1_500, 120_000, false, 'default')).toBe(120_000)

    const editWake = makeWakeup('edit_file', { Path: '/repo/a.ts', Target: 'a', Replacement: 'b' })
    expect(resolveWakeupStallTimeoutMs(editWake, 'standard', 1_500, 120_000, false, 'default')).toBe(1_500)
    expect(resolveWakeupStallTimeoutMs(editWake, 'standard', 1_500, 120_000, false, 'acceptEdits')).toBe(120_000)

    const askWake = makeWakeup('ask_question', { questions: [{ question: 'Pick?', options: ['A', 'B'] }] })
    expect(resolveWakeupStallTimeoutMs(askWake, 'auto', 1_500, 120_000, false, 'auto')).toBe(1_500)

    const bypassCmdWake = makeWakeup('run_command', { CommandLine: 'curl x', WaitMsBeforeAsync: 5_000, BypassSandbox: true })
    expect(resolveWakeupStallTimeoutMs(bypassCmdWake, 'auto', 1_500, 120_000, false, 'auto')).toBe(1_500)

    expect(normalizeTranscriptTool('swarm', { action: 'status' }).toolName).toBe('ManageSubagents')
    const swarmAdd = normalizeTranscriptTool('swarm', { action: 'add', name: 'verifier', brief: 'Run checks' })
    expect(swarmAdd.toolName).toBe('Agent')
    expect(swarmAdd.input.isSwarmWorker).toBe(true)
  })

  it('automatically reopens streamFence when a wakeup turn calls ask_question without waiting for manual user input', async () => {
    const sessionId = 'agy-204-ask-1'
    const { transcriptPath, restoreHome } = setupBrainHome(sessionId)
    const iso = new Date().toISOString()
    let promptCount = 0
    let questionAsked = false

    const app = createMockAgent(sessionId, async (ctx) => {
      promptCount += 1
      if (promptCount === 1) {
        const initial = [
          userLine(1, 'Analyze', iso),
          plannerLine(2, iso, { toolCalls: [{ id: 'call_bg_1', name: 'run_command', args: { CommandLine: 'scan.sh', WaitMsBeforeAsync: 500 } }] }),
          genericLine(3, 'RUNNING', `Created At: ${iso}\nTool is running as a background task with task id: ${sessionId}/task-3`, iso),
          plannerLine(4, iso, { content: '正在扫描仓库。' }),
        ]
        writeLines(transcriptPath, initial)
        await notifyBgForegroundTurn(ctx, sessionId, 'Analyze', 'call_bg_1', 'scan.sh', '正在扫描仓库。')
        setTimeout(() => {
          writeLines(transcriptPath, [
            ...initial,
            systemTaskLine(5, `${sessionId}/task-3`, '2 targets found', iso),
            plannerLine(6, iso, {
              content: '扫描完成，需要确认修复策略。',
              toolCalls: [{
                id: 'call_ask_wakeup',
                name: 'ask_question',
                args: { questions: [{ question: '选择哪种修复方案？', options: ['方案 A', '方案 B'], is_multi_select: false }] },
              }],
            }),
          ])
        }, 60)
        return { stopReason: 'end_turn' }
      }

      await ctx.client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: {
          toolCallId: 'call_ask_wakeup',
          title: 'Running ask_question',
          rawInput: { questions: [{ question: '选择哪种修复方案？', options: ['方案 A', '方案 B'], is_multi_select: false }] },
        },
        options: [
          { optionId: '0', name: '方案 A', kind: 'allow_once' },
          { optionId: '1', name: '方案 B', kind: 'allow_once' },
        ],
      })
      await ctx.client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'continuation' } },
      })
      await ctx.client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已按方案 A 完成处理。' } },
      })
      return { stopReason: 'end_turn' }
    })

    try {
      const wakeEvents: AgentEvent[] = []
      const runtime = await createAcpRuntime({
        launch: { agentId: 'antigravity', command: 'agy', defaultCwd: '/tmp' },
        permissionMode: 'default',
        permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
        askUserQuestion: {
          request: async (params) => {
            questionAsked = true
            return { answers: { [String(params.toolCallId)]: '方案 A' } }
          },
        },
        onSessionEvent: (ev) => wakeEvents.push(ev),
        streamFactory: async () => connectAgent(app),
      })

      await runtime.prompt('Analyze', 'msg-fg-1', () => undefined)

      await vi.waitFor(() => {
        expect(questionAsked).toBe(true)
        expect(wakeEvents.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '已按方案 A 完成处理。')).toBe(true)
        expect(wakeEvents.some((e) => e.type === 'message_complete')).toBe(true)
      }, { timeout: 3_000 })
      expect(wakeEvents.filter((e) => e.type === 'message_start')).toHaveLength(1)

      await runtime.close()
    } finally {
      restoreHome()
    }
  })

  it('waits past 1.5s for wakeup call_mcp_tool under acceptEdits without premature completion', async () => {
    const sessionId = 'agy-204-mcp-1'
    const { transcriptPath, restoreHome } = setupBrainHome(sessionId)
    const iso = new Date().toISOString()

    const initial = [
      userLine(1, 'Render report', iso),
      plannerLine(2, iso, { toolCalls: [{ id: 'call_bg_mcp', name: 'run_command', args: { CommandLine: 'collect.sh', WaitMsBeforeAsync: 500 } }] }),
      genericLine(3, 'RUNNING', `Created At: ${iso}\nTool is running as a background task with task id: ${sessionId}/task-3`, iso),
      plannerLine(4, iso, { content: '采集中。' }),
    ]

    const app = createMockAgent(sessionId, async (ctx) => {
      writeLines(transcriptPath, initial)
      await notifyBgForegroundTurn(ctx, sessionId, 'Render report', 'call_bg_mcp', 'collect.sh', '采集中。')
      const mid = [
        ...initial,
        systemTaskLine(5, `${sessionId}/task-3`, 'done', iso),
        plannerLine(6, iso, {
          toolCalls: [{ id: 'call_wake_widget', name: 'call_mcp_tool', args: { ServerName: 'superone-alpha', ToolName: 'widget_show', Arguments: '{"title":"Chart"}' } }],
        }),
      ]
      setTimeout(() => writeLines(transcriptPath, mid), 50)
      setTimeout(() => {
        writeLines(transcriptPath, [
          ...mid,
          genericLine(7, 'DONE', `Created At: ${iso}\nCompleted At: ${iso}\nWidget rendered`, iso),
          plannerLine(8, iso, { content: '图表与总结均已生成。' }),
        ])
      }, 1_850)
      return { stopReason: 'end_turn' }
    })

    try {
      const wakeEvents: AgentEvent[] = []
      const runtime = await createAcpRuntime({
        launch: { agentId: 'antigravity', command: 'agy', defaultCwd: '/tmp' },
        permissionMode: 'acceptEdits',
        permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
        onSessionEvent: (ev) => wakeEvents.push(ev),
        streamFactory: async () => connectAgent(app),
      })

      await runtime.prompt('Render report', 'msg-mcp-1', () => undefined)
      await new Promise((r) => setTimeout(r, 1_650))
      expect(wakeEvents.some((e) => e.type === 'message_complete')).toBe(false)

      await vi.waitFor(() => {
        expect(wakeEvents.some((e) => e.type === 'content_delta' && e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_wake_widget')).toBe(true)
        expect(wakeEvents.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === '图表与总结均已生成。')).toBe(true)
        expect(wakeEvents.some((e) => e.type === 'message_complete')).toBe(true)
      }, { timeout: 3_000 })

      await runtime.close()
    } finally {
      restoreHome()
    }
  })

  it('refreshes wakeupResponseTimeoutMs on active wakeup steps and tracks swarm(add) wakeups', async () => {
    const sessionId = 'agy-204-activity-swarm'
    const { brainRoot, transcriptPath, restoreHome } = setupBrainHome(sessionId)
    const iso = new Date().toISOString()

    try {
      const emitted: AgentEvent[] = []
      const base = [
        userLine(1, 'Run swarm', iso),
        plannerLine(2, iso, { toolCalls: [{ id: 'call_swarm_1', name: 'swarm', args: { action: 'add', name: 'auditor', brief: 'Audit files' } }] }),
        genericLine(3, 'DONE', `Created At: ${iso}\nCompleted At: ${iso}\nAdded @auditor to swarm board.`, iso),
      ]
      writeLines(transcriptPath, base)

      const normalizedSwarm = normalizeTranscriptTool('swarm', { action: 'add', name: 'auditor', brief: 'Audit files' })
      noteAntigravitySubagentEvents(
        sessionId,
        'msg-swarm-1',
        [{
          type: 'content_delta',
          messageId: 'msg-swarm-1',
          delta: {
            type: 'tool_use',
            toolUseId: 'call_swarm_1',
            toolName: normalizedSwarm.toolName,
            input: JSON.stringify(normalizedSwarm.input),
            status: 'complete',
          },
        }],
        (ev) => emitted.push(ev),
        [brainRoot],
      )

      const step4And5 = [
        ...base,
        JSON.stringify({
          step_index: 4,
          type: 'SYSTEM_MESSAGE',
          status: 'DONE',
          created_at: iso,
          content: `<SYSTEM_MESSAGE>\n[Message] sender=swarm/auditor priority=MESSAGE_PRIORITY_HIGH content=@coordinator Audit complete.\n</SYSTEM_MESSAGE>`,
        }),
        plannerLine(5, iso, { toolCalls: [{ id: 'call_read_slow', name: 'read_file', args: { Path: '/tmp/audit.md' } }] }),
      ]
      setTimeout(() => writeLines(transcriptPath, step4And5), 80)
      setTimeout(() => writeLines(transcriptPath, [...step4And5, genericLine(6, 'DONE', `Created At: ${iso}\nCompleted At: ${iso}\n# Audit OK`, iso)]), 320)
      setTimeout(() => {
        writeLines(transcriptPath, [
          ...step4And5,
          genericLine(6, 'DONE', `Created At: ${iso}\nCompleted At: ${iso}\n# Audit OK`, iso),
          plannerLine(7, iso, { content: 'Swarm 审查结果已汇总完毕。' }),
        ])
      }, 560)

      const outcome = await waitForAntigravitySubagentWakeup(sessionId, { wakeupResponseTimeoutMs: 420 })
      expect(outcome).toBe('completed')
      expect(emitted.some((e) => e.type === 'content_delta' && e.delta.type === 'text' && e.delta.text === 'Swarm 审查结果已汇总完毕。')).toBe(true)
      expect(emitted.some((e) => e.type === 'task_notification' && e.toolUseId === 'call_swarm_1' && e.taskStatus === 'completed')).toBe(true)
    } finally {
      restoreHome()
    }
  })
})
