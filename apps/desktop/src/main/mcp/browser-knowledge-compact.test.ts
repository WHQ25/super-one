import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerCompactBrowserTools, type PrimitiveRunner } from './browser-mcp-compact'
import type { BrowserToolReply } from './browser-mcp-replies'

function fixture(runner: PrimitiveRunner) {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<BrowserToolReply>>()
  const server = { registerTool: (name: string, _config: unknown, callback: (args: Record<string, unknown>) => Promise<BrowserToolReply>) => handlers.set(name, callback) }
  registerCompactBrowserTools(server as unknown as McpServer, 'session', runner, false)
  return (name: string, args: Record<string, unknown>) => handlers.get(name)!(args)
}
const text = (reply: BrowserToolReply) => reply.content.flatMap(c => c.type === 'text' ? [c.text] : []).join('\n')

describe('browser knowledge discovery and maintenance', () => {
  it('adds a node-independent memory pointer without breaking JSON results or console-only snapshots', async () => {
    const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ url: 'https://github.com', ok: true }) }] }))
    const call = fixture(run)
    const navigation = JSON.parse(text(await call('browser_tabs', { action: 'navigate', url: 'https://github.com' })))
    expect(navigation.memoryHint).toContain('browser_memory_read')
    expect(navigation.url).toBe('https://github.com')
    expect(JSON.parse(text(await call('browser_snapshot', { include: ['console'] })))).not.toHaveProperty('memoryHint')
  })
  it('reads only the requested saved definition and dispatches reversible archive operations', async () => {
    const action = { name: 'search', domain: 'github.com', steps: [] }
    const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ actions: [action] }) }] }))
    const call = fixture(run)
    expect(JSON.parse(text(await call('browser_action', { action: 'read', domain: 'github.com', name: 'search' })))).toEqual({ action })
    expect(run).toHaveBeenLastCalledWith('browser_action_list', { domain: 'github.com', name: 'search', includeSteps: true, includeArchived: true })
    await call('browser_action', { action: 'archive', domain: 'github.com', name: 'search', archived: false })
    expect(run).toHaveBeenLastCalledWith('browser_action_archive', { domain: 'github.com', name: 'search', archived: false })
    run.mockClear()
    expect((await call('browser_action', { action: 'archive' })).isError).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })
})
