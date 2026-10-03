import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { MCP_APP_RESULT_MAX_BYTES, type ToolAppAttachment } from '@superone/shared/mcp-apps'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('../database', () => ({ getDb: getDbMock }))
vi.mock('../recent-folders', () => ({ getProjectId: () => 'project-1' }))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../usage-stats-service', () => ({ recordSessionStarted: vi.fn(), recordMessageCounts: vi.fn() }))

import { saveSessionStateBySid } from './session-repo'

/** Captures `chat_messages` rows; every other statement is a write the code never reads back. */
function capturingDb(rows: unknown[][]) {
  return {
    prepare: (sql: string) => ({
      get: () => undefined,
      all: () => [],
      run: (...args: unknown[]) => { if (sql.includes('INSERT INTO chat_messages')) rows.push(args); return { changes: 1 } },
    }),
    transaction: (fn: () => void) => () => { fn() },
  }
}

const app = (id: string): ToolAppAttachment => ({
  appInstanceId: id, binding: { node: 'local', session: 'session-1', server: 'cad', configGeneration: 0, configFingerprint: 'x' },
  resourceUri: 'ui://cad/view', status: 'result', toolResult: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_RESULT_MAX_BYTES) }] },
})

describe('MCP App results in persisted messages', () => {
  it('stores the bounded attachment while the live message keeps the full result', () => {
    const rows: unknown[][] = []
    getDbMock.mockReturnValue(capturingDb(rows))
    const message: ChatMessage = {
      id: 'msg-1', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', providerId: 'codex-base',
      content: [{ type: 'tool_result', toolUseId: 'call', summary: 'ok', app: app('claude') }],
      metadata: { codex: { items: [{ type: 'mcp_tool_call', id: 'item', server: 'cad', tool: 'pick', status: 'completed', arguments: {}, app: app('codex') }] } } as ChatMessage['metadata'],
    }
    saveSessionStateBySid({ sid: 'session-1', projectPath: '/repo', providerId: 'codex-base', messages: [message], totalCostUsd: 0, contextTokens: 0, isWorktree: false })
    const [row] = rows
    const content = JSON.parse(row[5] as string), metadata = JSON.parse(row[8] as string)
    expect(content.content[0].app).toMatchObject({ toolResultOmitted: { reason: 'size_limit' } })
    expect(content.content[0].app.toolResult).toBeUndefined()
    expect(metadata.codex.items[0].app).toMatchObject({ toolResultOmitted: { reason: 'size_limit' } })
    expect((message.content[0] as { app: ToolAppAttachment }).app.toolResult).toBeDefined()
  })
})
