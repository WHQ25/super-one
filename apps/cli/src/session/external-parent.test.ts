import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createSqliteSessionStore } from '@superone/runtime/session'
import type { HostActionTerminalResult } from '@superone/shared/environment'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { SessionRuntime } from './session-runtime'
import { createHostActionMcpServer, type HostActionRequestFn, type NodeCollabToolHandlers } from './host-action-mcp-core'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function boot(dbPath: string) {
  const db = openNodeDatabase(dbPath)
  return new SessionRuntime(db, new EventLog(db, 'env-b'), { assertValid: () => {} } as never, 'env-b', async () => ({ finalText: 'ok' }))
}

describe('a collaboration child whose parent runs on another machine', () => {
  it('keeps its external parent and collaboration prompt across a node restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'external-parent-'))
    dirs.push(home)
    const dbPath = join(home, 'state.sqlite')
    const first = boot(dbPath)
    const created = first.create({
      projectId: 'p1',
      controllerClientSessionId: 'client-a',
      systemPromptAppend: 'collab prompt',
      externalParent: { sessionId: 'parent-a' },
    })
    expect(created.externalParent).toEqual({ sessionId: 'parent-a' })
    await first.dispose()

    const restarted = boot(dbPath)
    expect(restarted.get(created.sessionId)?.externalParent).toEqual({ sessionId: 'parent-a' })
    expect(restarted.getSystemPromptAppend(created.sessionId)).toContain('SuperOne session parent-a')
    expect(createSqliteSessionStore(openNodeDatabase(dbPath)).loadAll()[0]?.externalParent).toEqual({ sessionId: 'parent-a' })
    await restarted.dispose()
  })

  it('sends and retrieves through its controller and launches nothing', async () => {
    const reply = { content: [{ type: 'text' as const, text: '{"status":"sent"}' }] }
    const requestHostAction = vi.fn<HostActionRequestFn>(async () => ({ actionId: 'a1', state: 'succeeded', result: reply }) as HostActionTerminalResult)
    const local: NodeCollabToolHandlers = {
      listAgents: () => [],
      request: vi.fn(async () => ({ status: 'approved' })),
      start: vi.fn(async () => ({ status: 'started' })),
      send: vi.fn(async () => ({ status: 'sent', local: true })),
      retrieve: vi.fn(async () => ({ status: 'empty' })),
    }
    const external = new Set(['child'])
    const call = async (sessionId: string, name: string, args: Record<string, unknown>) => {
      const server = createHostActionMcpServer(sessionId, requestHostAction, {
        collab: local,
        hasExternalParent: (id) => external.has(id),
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      const client = new Client({ name: 'test', version: '1.0.0' })
      await client.connect(clientTransport)
      try {
        return await client.callTool({ name, arguments: args })
      } finally {
        await client.close()
      }
    }

    expect(await call('child', 'session_collab_send', { content: 'done' })).toMatchObject(reply)
    expect(requestHostAction).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'child', toolName: 'session_collab_send', toolGroup: 'superone', args: { content: 'done' },
    }))
    expect(local.send).not.toHaveBeenCalled()

    const refused = await call('child', 'session_collab_request', {
      launches: [{ agentId: 'claude-base', summary: 's', name: 'n', role: 'r' }],
    }) as { isError?: boolean; content: Array<{ text: string }> }
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toMatch(/Nested collaboration is not supported/)
    expect(local.request).not.toHaveBeenCalled()

    // A session of this node keeps its local mailbox.
    expect(await call('local-parent', 'session_collab_send', { content: 'hi' })).toMatchObject({
      content: [{ type: 'text', text: JSON.stringify({ status: 'sent', local: true }) }],
    })
  })
})
