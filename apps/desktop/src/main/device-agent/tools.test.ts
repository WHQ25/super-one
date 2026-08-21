import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerDeviceAgentTools } from './tools'

describe('registerDeviceAgentTools', () => {
  it('forwards the MCP request signal to device execution', async () => {
    let waitForHandler: ((args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>) | undefined
    const server = {
      registerTool: vi.fn((name: string, _config: unknown, handler: typeof waitForHandler) => {
        if (name === 'device_wait_for') waitForHandler = handler
      }),
    } as unknown as McpServer
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: '{}' }] }))
    registerDeviceAgentTools(server, 'session-1', execute)
    const controller = new AbortController()

    await waitForHandler?.({
      description: 'Wait for the result',
      condition: { kind: 'exists', label: 'Done' },
    }, { signal: controller.signal })

    expect(execute).toHaveBeenCalledWith(
      'session-1',
      'device_wait_for',
      expect.any(Object),
      controller.signal,
    )
  })
})
