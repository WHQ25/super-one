// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppContextState } from '@superone/shared/mcp-app-model-context'
import { forgetMcpAppArrivals } from './mcp-app-document'

const wire = vi.hoisted(() => ({ pairs: [] as Array<{ transport: Transport; target: Window }>, native: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: { error?: string }) => params?.error ? `${key}: ${params.error}` : key }) }))
vi.mock('./bridge', () => ({ requestNative: vi.fn(), requestNativeAsync: wire.native, NativeRequestTimeout: class extends Error {} }))
// Keep the real shared bridge and App SDK; only replace the browser transport.
vi.mock('@superone/shared/mcp-apps-host/transport', () => ({ createMcpAppTransport: (target: Window) => {
  const [host, view] = InMemoryTransport.createLinkedPair()
  wire.pairs.push({ transport: view, target })
  return host
} }))
import McpAppFrame from './McpAppFrame'

let root: Root | undefined, container: HTMLDivElement | undefined
const views: App[] = []
const saved: ToolAppAttachment = {
  appInstanceId: 'saved', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'cfg' },
  resourceUri: 'ui://cad', resource: { hash: 'a'.repeat(64), meta: {} }, status: 'result', toolInput: { page: 1 },
  toolResult: { content: [{ type: 'text', text: 'Saved result' }] },
  modelContext: { updateId: 'saved-context', content: [{ type: 'text', text: 'Selected part' }], source: { appInstanceId: 'saved', server: 'cad' } },
}
const html = '<html><body>pinned snapshot</body></html>'

afterEach(async () => {
  await act(async () => root?.unmount())
  await Promise.all(views.splice(0).map(view => view.close()))
  container?.remove(); root = undefined; container = undefined
  wire.pairs = []; wire.native.mockReset(); forgetMcpAppArrivals()
  vi.unstubAllGlobals()
})

async function mount(app: ToolAppAttachment = saved) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(McpAppFrame, { app, messageId: 'm', html, meta: saved.resource!.meta, toolName: 'mcp__cad__library', row: () => null })))
  await vi.waitFor(() => expect(wire.pairs).toHaveLength(1))
}

async function initialize(index: number) {
  const view = new App({ name: 'fixture', version: '1' }, {}, { autoResize: false })
  const inputs: unknown[] = [], results: unknown[] = []
  view.ontoolinput = input => { inputs.push(input) }
  view.ontoolresult = result => { results.push(result) }
  views.push(view)
  await act(async () => { await view.connect(wire.pairs[index].transport) })
  return { view, inputs, results }
}

it.each([false, true])('activation reinitializes pinned phone HTML and context (omitted=%s)', async omitted => {
  wire.native.mockResolvedValue({ response: { ok: true, value: {} } })
  const app = omitted ? { ...saved, toolResult: undefined, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' as const } } : saved
  await mount(app)
  const first = await initialize(0), oldFrame = container!.querySelector('iframe')
  await act(async () => { await expect(first.view.callServerTool({ name: 'cad.listParts' })).rejects.toThrow('Activate') })
  expect(wire.native).not.toHaveBeenCalled()
  const activate = [...container!.querySelectorAll('button')].find(button => button.textContent === 'mcpApp.activate')!
  await act(async () => activate.click())
  await vi.waitFor(() => expect(wire.pairs).toHaveLength(2))
  const next = await initialize(1), frame = container!.querySelector('iframe')!
  expect(frame).not.toBe(oldFrame)
  expect(frame.srcdoc).toContain(html)
  expect(wire.pairs[1].target).toBe(frame.contentWindow)
  expect(next.view.getHostContext()?.['openai/modelContext']).toEqual(mcpAppContextState(saved))
  expect(next.inputs).toEqual([{ arguments: saved.toolInput }])
  expect(next.results).toEqual(omitted ? [] : [saved.toolResult])
  expect(wire.native.mock.calls.map(call => call[1].operation)).toEqual(['activate'])
  // Only the App's own startup request reloads data; the host never replays the origin tool.
  wire.native.mockResolvedValue({ response: { ok: true, value: { outcome: 'completed', result: { content: [] } } } })
  await next.view.callServerTool({ name: 'cad.listParts' })
  expect(wire.native.mock.calls.map(call => [call[1].operation, call[1].tool])).toEqual([['activate', undefined], ['callTool', 'cad.listParts']])
  expect(app.resource?.hash).toBe(saved.resource?.hash)
})

it('failed phone activation keeps the existing document and reports the error', async () => {
  wire.native.mockResolvedValue({ response: { ok: false, error: { code: 'not_connected', message: 'Server unavailable' } } })
  await mount(); await initialize(0)
  const oldFrame = container!.querySelector('iframe')
  const activate = [...container!.querySelectorAll('button')].find(button => button.textContent === 'mcpApp.activate')!
  await act(async () => activate.click())
  expect(container!.querySelector('iframe')).toBe(oldFrame)
  expect(container!.textContent).toContain('Server unavailable')
  expect(wire.pairs).toHaveLength(1)
  expect(wire.native.mock.calls.map(call => call[1].operation)).toEqual(['activate'])
})
