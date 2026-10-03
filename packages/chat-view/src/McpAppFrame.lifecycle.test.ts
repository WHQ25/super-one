// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { afterEach, expect, it, vi } from 'vitest'
import { MCP_APP_OUTPUT_MAX_BYTES, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppContextState } from '@superone/shared/mcp-app-model-context'
import { exitMcpAppFullscreen, forgetMcpAppArrivals, markMcpAppActivated } from './mcp-app-document'
import { requestNative } from './bridge'

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
  wire.pairs = []; wire.native.mockReset(); vi.mocked(requestNative).mockReset(); forgetMcpAppArrivals()
  vi.unstubAllGlobals()
})

async function mount(app: ToolAppAttachment = saved) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(McpAppFrame, { app, messageId: 'm', html, meta: saved.resource!.meta, toolName: 'mcp__cad__library', details: null })))
  await vi.waitFor(() => expect(wire.pairs).toHaveLength(1))
}

const activateButton = () => container!.querySelector<HTMLButtonElement>('[data-mcp-app-activate]')

async function initialize(index: number, capabilities: ConstructorParameters<typeof App>[1] = {}) {
  const view = new App({ name: 'fixture', version: '1' }, capabilities, { autoResize: false })
  const inputs: unknown[] = [], results: unknown[] = []
  view.ontoolinput = input => { inputs.push(input) }
  view.ontoolresult = result => { results.push(result) }
  views.push(view)
  await act(async () => { await view.connect(wire.pairs[index].transport) })
  return { view, inputs, results }
}

it('loads behind the state card and shows the View once it initializes', async () => {
  await mount()
  expect(container!.querySelector('[data-mcp-app-state-card]')?.textContent).toContain('mcpApp.loading')
  await initialize(0)
  expect(container!.querySelector('[data-mcp-app-state-card]')).toBeNull()
  expect(container!.querySelector('iframe')).not.toBeNull()
})

it('explains an omitted result on the activate action and drops it after activation', async () => {
  wire.native.mockResolvedValue({ response: { ok: true, value: {} } })
  await mount({ ...saved, toolResult: undefined, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' } })
  await initialize(0)
  expect(activateButton()?.getAttribute('aria-label')).toBe('mcpApp.activate')
  expect(activateButton()?.hasAttribute('data-mcp-app-result-omitted')).toBe(true)
  await act(async () => activateButton()!.click())
  await vi.waitFor(() => expect(wire.pairs).toHaveLength(2))
  await initialize(1)
  expect(activateButton()).toBeNull()
})

it('bounds a result above the live cap before rendering the phone View', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await mount({ ...saved, toolResult: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES) }] } })
    await initialize(0)
    expect(activateButton()?.hasAttribute('data-mcp-app-result-omitted')).toBe(true)
    expect(warn).toHaveBeenCalled()
  } finally { warn.mockRestore() }
})

it('collapses the View into a row and expands it again', async () => {
  await mount(); await initialize(0)
  const surface = container!.querySelector('iframe')!.parentElement!
  const toggle = container!.querySelector<HTMLElement>('[data-embedded-tool-toggle]')!
  await act(async () => toggle.click())
  expect(surface.style.height).toBe('0px')
  expect(container!.querySelector('[data-embedded-tool-header]')?.hasAttribute('data-collapsed')).toBe(true)
  await act(async () => container!.querySelector<HTMLElement>('[data-embedded-tool-title]')!.click())
  expect(surface.style.height).not.toBe('0px')
})

it.each([false, true])('activation reinitializes pinned phone HTML and context (omitted=%s)', async omitted => {
  wire.native.mockResolvedValue({ response: { ok: true, value: {} } })
  const app = omitted ? { ...saved, toolResult: undefined, toolResultOmitted: { bytes: 1050849, reason: 'size_limit' as const } } : saved
  await mount(app)
  const first = await initialize(0), oldFrame = container!.querySelector('iframe')
  await act(async () => { await expect(first.view.callServerTool({ name: 'cad.listParts' })).rejects.toThrow('Activate') })
  expect(wire.native).not.toHaveBeenCalled()
  const activate = activateButton()!
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
  const activate = activateButton()!
  await act(async () => activate.click())
  expect(container!.querySelector('iframe')).toBe(oldFrame)
  expect(container!.textContent).toContain('Server unavailable')
  expect(wire.pairs).toHaveLength(1)
  expect(wire.native.mock.calls.map(call => call[1].operation)).toEqual(['activate'])
})

it.each(['reload', 'unmount'])('cancels pending phone consent on %s and ignores a stale confirm', async reason => {
  markMcpAppActivated(saved.appInstanceId)
  wire.native.mockResolvedValue({ response: { ok: false, error: { code: 'approval_required', challenge: 'c', prompt: { kind: 'sendMessage', server: 'cad', text: 'Send', nonTextBlocks: 0 } } } })
  await mount()
  const { view } = await initialize(0)
  // Keep the real SDK request pending until the native consent card appears.
  let send!: Promise<unknown>
  await act(async () => {
    send = view.sendMessage({ role: 'user', content: [{ type: 'text', text: 'Send' }] }).catch(error => error)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await vi.waitFor(() => expect(container!.querySelector('[role=dialog]')).not.toBeNull())
  const confirm = [...container!.querySelectorAll('button')].find(button => button.textContent === 'mcpApp.send')!
  if (reason === 'reload') {
    const frame = container!.querySelector('iframe')!
    // The first document load is accepted; the second revokes its lifetime.
    await act(async () => { frame.dispatchEvent(new Event('load')); frame.dispatchEvent(new Event('load')) })
    expect(container!.querySelector('[role=dialog]')).toBeNull()
  } else {
    await act(async () => root!.unmount()); root = undefined
  }
  await act(async () => confirm.click())
  await send
  expect(wire.native.mock.calls.map(call => call[1].operation)).toEqual(['sendMessage'])
})

it('goes fullscreen without its frame, in the same document, and leaves through native back', async () => {
  markMcpAppActivated(saved.appInstanceId)
  await mount()
  const { view } = await initialize(0, { availableDisplayModes: ['inline', 'fullscreen'] })
  const frame = container!.querySelector('iframe')
  await act(async () => { await expect(view.requestDisplayMode({ mode: 'fullscreen' })).resolves.toEqual({ mode: 'fullscreen' }) })
  expect(container!.querySelector('[data-mcp-app-fullscreen]')).not.toBeNull()
  // The native header names the View and is the way out, so the frame's own header is hidden, not unmounted.
  expect(container!.querySelector('[data-embedded-tool-header]')?.parentElement?.className).toContain('[&>[data-embedded-tool-header]]:hidden')
  expect(container!.querySelector('iframe')).toBe(frame)
  expect(requestNative).toHaveBeenLastCalledWith('mcpAppFullscreen', { active: true, title: 'cad' })
  await vi.waitFor(() => expect(view.getHostContext()?.displayMode).toBe('fullscreen'))
  await act(async () => { expect(exitMcpAppFullscreen()).toBe(true) })
  expect(container!.querySelector('[data-mcp-app-fullscreen]')).toBeNull()
  expect(container!.querySelector('iframe')).toBe(frame)
  expect(requestNative).toHaveBeenLastCalledWith('mcpAppFullscreen', { active: false })
  await vi.waitFor(() => expect(view.getHostContext()?.displayMode).toBe('inline'))
})

it('keeps a restored View inline until it is activated, where its Activate action is', async () => {
  await mount()
  const { view } = await initialize(0, { availableDisplayModes: ['inline', 'fullscreen'] })
  await act(async () => { await expect(view.requestDisplayMode({ mode: 'fullscreen' })).rejects.toThrow('Activate') })
  expect(container!.querySelector('[data-mcp-app-fullscreen]')).toBeNull()
  expect(activateButton()).not.toBeNull()
  expect(requestNative).not.toHaveBeenCalledWith('mcpAppFullscreen', expect.objectContaining({ active: true }))
})
