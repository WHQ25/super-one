/** @vitest-environment jsdom */

import { expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  send: vi.fn(),
}))

vi.mock('electron', () => ({ ipcRenderer: ipc }))

it('keeps Blink schema strings single-encoded and replaces invalid JSON', async () => {
  const modelContext = {
    addEventListener: vi.fn(),
    executeTool: vi.fn(),
    getTools: vi.fn(async () => [
      {
        name: 'string-schema',
        description: 'Already serialized by Blink.',
        inputSchema: '{"type":"object"}',
      },
      {
        name: 'object-schema',
        description: 'Compatibility with object-valued schemas.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
      {
        name: 'invalid-schema',
        description: 'Malformed serialized schema.',
        inputSchema: 'not-json',
      },
    ]),
  }
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: modelContext,
  })

  await import('./webmcp-preload')
  await vi.waitFor(() => expect(ipc.send).toHaveBeenCalledWith(
    'webmcp:sync',
    expect.objectContaining({ tools: expect.any(Array) }),
  ))

  const sync = ipc.send.mock.calls.find(([channel]) => channel === 'webmcp:sync')?.[1] as {
    tools: Array<{ name: string; inputSchema: string; truncated?: true }>
  }
  expect(sync.tools).toEqual([
    expect.objectContaining({
      name: 'string-schema',
      inputSchema: '{"type":"object"}',
    }),
    expect.objectContaining({
      name: 'object-schema',
      inputSchema: '{"type":"object","properties":{"text":{"type":"string"}}}',
    }),
    expect.objectContaining({
      name: 'invalid-schema',
      inputSchema: '{"type":"object"}',
      truncated: true,
    }),
  ])
})
