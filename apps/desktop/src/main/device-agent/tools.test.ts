import { describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getDeviceAgentToolDescriptors, registerDeviceAgentTools } from './tools'

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

  it('rejects a condition that names no element before it reaches the device', async () => {
    // `text` sits beside `label` in the schema, so this is the shape a model reaches
    // for. Left alone it matches nothing, which notExists reads as "already gone".
    let waitForHandler: ((args: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>) | undefined
    const server = {
      registerTool: vi.fn((name: string, _config: unknown, handler: typeof waitForHandler) => {
        if (name === 'device_wait_for') waitForHandler = handler
      }),
    } as unknown as McpServer
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: '{}' }] }))
    registerDeviceAgentTools(server, 'session-1', execute)

    await expect(waitForHandler?.({
      description: 'Wait for the spinner to go',
      condition: { kind: 'notExists', text: 'Loading' },
    }, { signal: new AbortController().signal })).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })

  it('still produces a JSON Schema for the stdio surface once conditions are refined', () => {
    // The refinements above are invisible to JSON Schema; what matters is that
    // generating the descriptors does not throw and the field survives.
    const waitFor = getDeviceAgentToolDescriptors().find((tool) => tool.name === 'device_wait_for')
    const properties = (waitFor?.inputSchema as { properties?: Record<string, unknown> }).properties
    expect(properties?.condition).toBeTruthy()
  })
})
