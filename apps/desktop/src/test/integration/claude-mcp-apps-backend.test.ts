import { describe, expect, it, vi } from 'vitest'
import { ClaudeMcpAppsCatalog, ClaudeToolApps } from '@superone/claude/mcp-apps'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { MessageBridge } from '../../main/agent/message-bridge'
import fixture from '../fixtures/recordings/claude-mcp-apps.sdk.json'

// Recording: one turn that calls the fixture UI tool directly (page 1), then
// from an async subagent (page 3). Captured against a live CLI with the MCP
// Apps host flag set.
const recording = fixture as unknown as { status: unknown[]; messages: Array<Record<string, unknown>> }
const DIRECT = 'toolu_01RsqBqk6AUEJtJxUZzmENL4'
const SUBAGENT = 'toolu_01PcRg1t9DGYuiBGVWSPfGTL'

const state = vi.hoisted(() => ({ messages: [] as Array<Record<string, unknown>> }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const messages = [...state.messages]
    return {
      async *[Symbol.asyncIterator]() { yield* messages },
      interrupt: vi.fn(),
      setModel: vi.fn(),
    }
  }),
  createSdkMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))
vi.mock('../../main/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../main/agent/event-trace', () => ({ trace: vi.fn() }))
vi.mock('../../main/mcp/superone-mcp-server', () => ({ createSuperoneMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })) }))
// Replays a recording and never spawns; see queued-interrupt-backend.test.ts.
vi.mock('../../main/harness/resolve-runtime', () => ({
  resolveHarnessRuntime: () => '/mock/claude',
  tryResolveHarnessRuntime: () => '/mock/claude',
  HarnessNotReadyError: class HarnessNotReadyError extends Error {
    code = 'HARNESS_NOT_READY' as const
  },
  isHarnessNotReadyError: (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'HARNESS_NOT_READY',
}))

const { createSessionQuery } = await import('../../main/agent/claude-query')

/** Every app attachment on a tool row, in emission order, keyed by the harness call id. */
async function replay(): Promise<Map<string, ToolAppAttachment[]>> {
  state.messages = recording.messages
  const catalog = new ClaudeMcpAppsCatalog()
  catalog.update(recording.status as never)
  const toolApps = new ClaudeToolApps({
    catalog,
    binding: (server) => ({ node: 'local', session: 's1', server, configGeneration: 0, configFingerprint: 'fp' }),
    providerSessionId: () => 'sid',
  })
  const apps = new Map<string, ToolAppAttachment[]>()
  const handle = createSessionQuery(
    { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
    { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn(), abortController: new AbortController(), toolApps },
    (event) => {
      const app = event.type === 'content_delta' ? (event.delta as { app?: ToolAppAttachment }).app : undefined
      if (app) apps.set(app.harnessCallId, [...(apps.get(app.harnessCallId) ?? []), app])
    },
    () => 'msg_1',
    () => Date.now(),
    () => false,
  )
  await handle.iterationDone
  return apps
}

describe('Claude MCP Apps — backend replay (recording: claude-mcp-apps.sdk)', () => {
  it('attaches the View to the direct call from tool input through the structured result', async () => {
    const direct = (await replay()).get(DIRECT)!
    expect(direct.map((a) => a.status)).toEqual(['pending', 'result'])
    expect(direct[0]).toMatchObject({
      appInstanceId: `claude:s1:${DIRECT}`,
      resourceUri: 'ui://fixture/items.html',
      origin: { providerSessionId: 'sid' },
      toolInput: { page: 1 },
    })
    expect(direct[1]!.toolResult).toMatchObject({
      structuredContent: { items: ['item-1', 'item-2', 'item-3'], page: 1 },
      _meta: { 'fixture/private': { token: 'private-1' } },
    })
  })

  it('renders a subagent call from the tool_result block, since the SDK keeps only _meta there', async () => {
    const sub = (await replay()).get(SUBAGENT)!
    expect(sub.map((a) => a.status)).toEqual(['pending', 'result'])
    const result = sub[1]!.toolResult!
    expect(result.structuredContent).toBeUndefined()
    expect(result._meta).toMatchObject({ 'fixture/private': { token: 'private-3' } })
    expect(JSON.stringify(result.content)).toContain('item-7')
  })

  it('leaves non-UI tools, including the subagent launcher, without an app', async () => {
    expect([...(await replay()).keys()].sort()).toEqual([DIRECT, SUBAGENT].sort())
  })
})
