import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpAppsError } from '@superone/shared/mcp-apps'

const native = vi.hoisted(() => ({ async: vi.fn(), fire: vi.fn() }))
vi.mock('./bridge', async (importOriginal) => ({
  ...await importOriginal<typeof import('./bridge')>(),
  requestNativeAsync: native.async,
  requestNative: native.fire,
}))

const { NativeRequestTimeout } = await import('./bridge')
const { createMcpAppExecutor } = await import('./mcp-app-executor')
const { forgetMcpAppArrivals, markMcpAppActivated, mcpAppNeedsActivation } = await import('./mcp-app-document')

const target = { messageId: 'm', appInstanceId: 'view-1' }
const signal = new AbortController().signal
/** The shell wraps the host's answer so its own acknowledgement cannot clobber `ok`. */
const host = (response: unknown) => ({ ok: true, response })
const prompt = { kind: 'sendMessage' as const, server: 'fixture', text: 'hi', nonTextBlocks: 0 }
const message = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }

function executor(decision = true) {
  const consent = { approve: vi.fn(async () => decision) }
  return { consent, run: createMcpAppExecutor(target, consent, (mode) => mode) }
}

beforeEach(() => { native.async.mockReset(); native.fire.mockReset() })

describe('MCP App executor on the phone', () => {
  it('names only the View; the host resolves session, server and binding', async () => {
    native.async.mockResolvedValue(host({ ok: true, value: { contents: [] } }))
    await executor().run.readResource({ uri: 'ui://fixture/items.html' }, signal)
    expect(native.async).toHaveBeenCalledWith('mcpApp', { ...target, operation: 'readResource', uri: 'ui://fixture/items.html' }, undefined)
  })

  it('sends a tool call the user made in the View without asking again', async () => {
    const value = { result: { content: [] }, outcome: 'completed' }
    native.async.mockResolvedValueOnce(host({ ok: true, value }))
    const { run, consent } = executor()
    await expect(run.callTool({ tool: 'fixture_next_page', args: { page: 2 } }, signal)).resolves.toEqual(value)
    expect(native.async).toHaveBeenCalledWith('mcpApp', { ...target, operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }, 120_000)
    expect(consent.approve).not.toHaveBeenCalled()
  })

  it('confirms a message the View wrote and resends the identical operation with the challenge', async () => {
    native.async
      .mockResolvedValueOnce(host({ ok: false, error: { code: 'approval_required', challenge: 'c1', prompt } }))
      .mockResolvedValueOnce(host({ ok: true, value: {} }))
    const { run, consent } = executor()
    await expect(run.sendMessage(message, signal)).resolves.toEqual({})
    expect(consent.approve).toHaveBeenCalledWith(prompt)
    const [first, second] = native.async.mock.calls
    expect(second![1]).toEqual({ ...first![1], approval: { challenge: 'c1' } })
  })

  it('forgets the activation of a View the host stopped serving, without replaying the call', async () => {
    markMcpAppActivated(target.appInstanceId)
    native.async.mockResolvedValue(host({ ok: false, error: { code: 'inactive', message: 'Activate this restored MCP App to reconnect' } }))
    await expect(executor().run.callTool({ tool: 'fixture_next_page', args: {} }, signal)).rejects.toMatchObject({ code: 'inactive' })
    expect(native.async).toHaveBeenCalledTimes(1)
    expect(mcpAppNeedsActivation(target.appInstanceId)).toBe(true)
    forgetMcpAppArrivals()
  })

  it('surfaces the host gate, e.g. a model-only tool, as a structured error', async () => {
    native.async.mockResolvedValue(host({ ok: false, error: { code: 'denied', message: 'This tool is not available to the App' } }))
    const call = executor().run.callTool({ tool: 'fixture_model_echo', args: {} }, signal)
    await expect(call).rejects.toBeInstanceOf(McpAppsError)
    await expect(call).rejects.toMatchObject({ code: 'denied' })
  })

  it('reports a timed-out call as an unknown outcome and never resends it', async () => {
    native.async.mockRejectedValue(new NativeRequestTimeout())
    const response = await executor().run.callTool({ tool: 't', args: {} }, signal)
    expect(response.outcome).toBe('unknown_outcome')
    expect(response.result.isError).toBe(true)
    expect(native.async).toHaveBeenCalledTimes(1)
    expect(native.async.mock.calls[0]![2]).toBe(120_000)
  })

  it('treats a call the relay lost after sending as an unknown outcome', async () => {
    native.async.mockResolvedValue(host({ ok: false, error: { code: 'unknown_outcome', message: 'rpc timeout: mcp_app_request' } }))
    const response = await executor().run.callTool({ tool: 't', args: {} }, signal)
    expect(response.outcome).toBe('unknown_outcome')
    expect(native.async).toHaveBeenCalledTimes(1)
  })

  it('keeps read timeouts as plain retryable errors', async () => {
    native.async.mockRejectedValue(new NativeRequestTimeout())
    await expect(executor().run.readResource({ uri: 'ui://x' }, signal)).rejects.toBeInstanceOf(NativeRequestTimeout)
  })

  it('answers a declined message as an error instead of sending it', async () => {
    native.async.mockResolvedValueOnce(host({ ok: false, error: { code: 'approval_required', challenge: 'c2', prompt } }))
    await expect(executor(false).run.sendMessage(message, signal)).resolves.toEqual({ isError: true })
    expect(native.async).toHaveBeenCalledTimes(1)
  })

  it('opens a link the way the transcript does, without an App-specific confirmation', async () => {
    const { run, consent } = executor()
    await expect(run.openLink({ url: 'https://example.com' }, signal)).resolves.toEqual({})
    expect(native.fire).toHaveBeenCalledWith('openLink', { url: 'https://example.com' })
    expect(consent.approve).not.toHaveBeenCalled()
    expect(native.async).not.toHaveBeenCalled()
  })
})
