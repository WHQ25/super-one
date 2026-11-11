import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  HOST_ACTION_WIDGET_DESCRIPTORS,
  WIDGET_SAVE_DESCRIPTOR,
} from '@superone/shared/environment/host-action-widget-descriptors'
import { jsonSchemaToZodShape } from './json-schema-zod'
import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
} from './superone-mcp-builtin-defs'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: vi.fn(),
}))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({}),
}))

const { listSuperoneMcpTools } = await import('./superone-mcp-tool-surface')

function toolSignature(tool: SuperoneMcpToolDescriptor): string {
  return JSON.stringify([tool.description, tool.inputSchema, tool.icons ?? null, tool._meta ?? null])
}

describe('superone-mcp-stdio-bridge tool registration parity', () => {
  it('registers synchronous floor and live refresh on a real McpServer without duplicate errors', async () => {
    expect((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes('widget_save')).toBe(false)
    expect(HOST_ACTION_WIDGET_DESCRIPTORS.some((d) => d.name === 'widget_save')).toBe(false)

    const server = new McpServer({ name: 'superone', version: '1.0.0' })
    const registeredTools = new Map<string, RegisteredTool>()
    const toolSignatures = new Map<string, string>()

    const registerTool = (tool: SuperoneMcpToolDescriptor) => {
      const registered = server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: jsonSchemaToZodShape(tool.inputSchema),
        },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      )
      registeredTools.set(tool.name, registered)
      toolSignatures.set(tool.name, toolSignature(tool))
    }

    for (const def of [
      ...BUILT_IN_SUPERONE_TOOL_DEFS,
      ...HOST_ACTION_WIDGET_DESCRIPTORS,
      WIDGET_SAVE_DESCRIPTOR,
    ]) {
      registerTool(def)
    }

    const liveTools = listSuperoneMcpTools('/proj-parity')
    for (const tool of liveTools) {
      const sig = toolSignature(tool)
      const existing = registeredTools.get(tool.name)
      if (existing && toolSignatures.get(tool.name) === sig) continue
      if (existing) existing.remove()
      registerTool(tool)
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const listed = await client.listTools()
    const names = listed.tools.map((t) => t.name)
    expect(names).toContain('read_manual')
    expect(names).toContain('widget_list_templates')
    expect(names).toContain('widget_show')
    expect(names).toContain('widget_save')

    await client.close()
    await server.close()
  })
})
