import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { InteractionMemoryStore } from '@superone/runtime/fs/interaction-memory'
import { createHostActionMcpServer } from './host-action-mcp-core'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

describe('node-local interaction memory MCP', () => {
  it.each([
    { family: 'browser', identity: { domain: 'github.com' } },
    { family: 'computer', identity: { platform: 'macos', appId: 'com.apple.TextEdit' } },
    { family: 'device', identity: { platform: 'android', appId: 'com.example.app' } },
  ])('persists $family memory across sessions without Host Actions and isolates nodes', async ({ family, identity }) => {
    const requestHostAction = vi.fn()
    async function connect(home?: string) {
      const dir = home ?? await mkdtemp(join(tmpdir(), 'node-browser-memory-'))
      if (!home) cleanup.push(() => rm(dir, { recursive: true, force: true }))
      const server = createHostActionMcpServer('session', requestHostAction, {
        memory: new InteractionMemoryStore(dir),
        resolveActor: (sessionId) => (sessionId === 'session' ? 'superone-claude/claude-opus-5' : undefined),
      })
      const client = new Client({ name: 'memory-test', version: '1' })
      const [a, b] = InMemoryTransport.createLinkedPair()
      await server.connect(a)
      await client.connect(b)
      cleanup.push(() => client.close())
      cleanup.push(() => server.close())
      return { client, dir }
    }
    const a = await connect()
    expect((await a.client.listTools()).tools.map(t => t.name)).toEqual(expect.arrayContaining([`${family}_memory_read`, `${family}_memory_write`]))
    const note = { ...identity, topic: 'search', description: 'Search', content: 'Wait for results.' }
    const saved = await a.client.callTool({ name: `${family}_memory_write`, arguments: note })
    expect(saved.isError).toBeFalsy()
    expect(JSON.stringify(saved)).toContain('superone-claude/claude-opus-5')
    const resumed = await connect(a.dir)
    const found = await resumed.client.callTool({ name: `${family}_memory_read`, arguments: { ...identity, topic: note.topic } })
    expect(JSON.stringify(found)).toContain(note.content)
    const b = await connect()
    const empty = await b.client.callTool({ name: `${family}_memory_read`, arguments: identity })
    expect(JSON.stringify(empty)).toContain('\\"count\\":0')
    expect(requestHostAction).not.toHaveBeenCalled()
  })
})
