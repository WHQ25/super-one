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
import { disposeAntigravitySubagentTracker } from './antigravity-subagent'

const tempDirs: string[] = []

function makeTempBrainRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'superone-agy-bg-rt-'))
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

describe('antigravity background wakeup in createAcpRuntime', () => {
  it('streams post-wakeup reply in createAcpRuntime and drops pre-user_message_chunk replay on next prompt', async () => {
    const brainRoot = makeTempBrainRoot()
    const prevHome = process.env.SUPERONE_HOME
    process.env.SUPERONE_HOME = brainRoot

    const sessionId = 'agy-rt-session-1'
    const logsDir = join(brainRoot, 'antigravity', 'profile', 'brain', sessionId, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    mkdirSync(join(brainRoot, 'antigravity'), { recursive: true })
    const transcriptPath = join(logsDir, 'transcript_full.jsonl')
    const nowIso = new Date().toISOString()

    let promptTurnCount = 0
    const makeStream = (): { stream: Stream; dispose: () => void } => {
      const app = agent({ name: 'mock-agy' })
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
              JSON.stringify({ step_index: 1, type: 'USER_INPUT', status: 'DONE', created_at: nowIso, content: 'Run build' }),
              JSON.stringify({
                step_index: 2,
                type: 'PLANNER_RESPONSE',
                status: 'DONE',
                created_at: nowIso,
                tool_calls: [{ id: 'call_rt_bg_1', name: 'run_command', args: { CommandLine: 'bun run build', WaitMsBeforeAsync: 5000 } }],
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
                type: 'PLANNER_RESPONSE',
                status: 'DONE',
                created_at: nowIso,
                content: '已启动构建命令，等待后台任务完成。',
              }),
            ]
            writeFileSync(transcriptPath, `${initialTranscript.join('\n')}\n`, 'utf8')

            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Run build' } },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'call_rt_bg_1',
                title: 'Run command',
                kind: 'execute',
                status: 'in_progress',
                rawInput: { CommandLine: 'bun run build', WaitMsBeforeAsync: 5000, toolSummary: 'Package build' },
              },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId,
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已启动构建命令，等待后台任务完成。' } },
            })

            setTimeout(() => {
              writeFileSync(
                transcriptPath,
                [
                  ...initialTranscript,
                  JSON.stringify({
                    step_index: 5,
                    type: 'SYSTEM_MESSAGE',
                    status: 'DONE',
                    created_at: nowIso,
                    content: `<SYSTEM_MESSAGE>\n[Message] timestamp=${nowIso} sender=${sessionId}/task-3 priority=MESSAGE_PRIORITY_HIGH content=Task id "${sessionId}/task-3" finished with result:\nCommand exited with code 0.\n\nCommand output:\nBuild succeeded in 6.2s\n</SYSTEM_MESSAGE>`,
                  }),
                  JSON.stringify({
                    step_index: 6,
                    type: 'PLANNER_RESPONSE',
                    status: 'DONE',
                    created_at: nowIso,
                    thinking: 'Build completed cleanly.',
                    content: '后台构建已完成，产物校验通过。',
                  }),
                ].join('\n') + '\n',
                'utf8',
              )
            }, 80)

            return { stopReason: 'end_turn' }
          }

          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'call_rt_bg_1',
              title: 'Run command',
              kind: 'execute',
              status: 'completed',
              rawInput: { CommandLine: 'bun run build' },
              rawOutput: 'Command exited with code 0.\n\nCommand output:\nBuild succeeded in 6.2s',
            },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Build completed cleanly.' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '后台构建已完成，产物校验通过。' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Next question' } },
          })
          await ctx.client.notify(methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '这是第二轮的新回复。' } },
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
        permission: {
          request: async () => ({ outcome: { outcome: 'cancelled' } }),
        },
        streamFactory: async () => makeStream(),
      })

      const turn1Events: AgentEvent[] = []
      await runtime.prompt('Run build', 'msg-turn-1', (ev) => turn1Events.push(ev))

      expect(
        turn1Events.some(
          (e) =>
            e.type === 'content_delta' &&
            e.delta.type === 'tool_result' &&
            e.delta.toolUseId === 'call_rt_bg_1' &&
            e.delta.summary === 'Build succeeded in 6.2s',
        ),
      ).toBe(true)
      expect(
        turn1Events.some(
          (e) =>
            e.type === 'content_delta' &&
            e.delta.type === 'text' &&
            e.delta.text === '后台构建已完成，产物校验通过。',
        ),
      ).toBe(true)
      expect(turn1Events.some((e) => e.type === 'message_complete' && e.messageId === 'msg-turn-1')).toBe(true)

      const turn2Events: AgentEvent[] = []
      await runtime.prompt('Next question', 'msg-turn-2', (ev) => turn2Events.push(ev))

      expect(
        turn2Events.some(
          (e) =>
            e.type === 'content_delta' &&
            (e.delta.type === 'tool_use' || e.delta.type === 'tool_result'),
        ),
      ).toBe(false)
      const turn2TextDeltas = turn2Events
        .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
        .filter((e) => e.delta.type === 'text')
        .map((e) => (e.delta as { text: string }).text)
      expect(turn2TextDeltas.join('')).toBe('这是第二轮的新回复。')

      await runtime.close()
    } finally {
      if (prevHome === undefined) delete process.env.SUPERONE_HOME
      else process.env.SUPERONE_HOME = prevHome
    }
  })
})
