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

const target = { messageId: 'm', appInstanceId: 'view-1' }
const signal = new AbortController().signal
/** The shell wraps the host's answer so its own acknowledgement cannot clobber `ok`. */
const host = (response: unknown) => ({ ok: true, response })
const prompt = { kind: 'callTool' as const, server: 'fixture', tool: 'fixture_next_page', argsPreview: '{}', rememberable: true }

function executor(decision: { remember: boolean } | null = { remember: false }, link = true) {
  const consent = { approve: vi.fn(async () => decision), confirmLink: vi.fn(async () => link) }
  return { consent, run: createMcpAppExecutor(target, consent, (mode) => mode) }
}

beforeEach(() => { native.async.mockReset(); native.fire.mockReset() })

describe('MCP App executor on the phone', () => {
  it('names only the View; the host resolves session, server and binding', async () => {
    native.async.mockResolvedValue(host({ ok: true, value: { contents: [] } }))
    await executor().run.readResource({ uri: 'ui://fixture/items.html' }, signal)
    expect(native.async).toHaveBeenCalledWith('mcpApp', { ...target, operation: 'readResource', uri: 'ui://fixture/items.html' }, undefined)
  })

  it('confirms a challenged call here and resends the identical operation with the challenge', async () => {
    const value = { result: { content: [] }, outcome: 'completed' }
    native.async
      .mockResolvedValueOnce(host({ ok: false, error: { code: 'approval_required', challenge: 'c1', prompt } }))
      .mockResolvedValueOnce(host({ ok: true, value }))
    const { run, consent } = executor({ remember: true })
    await expect(run.callTool({ tool: 'fixture_next_page', args: { page: 2 } }, signal)).resolves.toEqual(value)
    expect(consent.approve).toHaveBeenCalledWith(prompt)
    const [first, second] = native.async.mock.calls
    expect(second![1]).toEqual({ ...first![1], approval: { challenge: 'c1', remember: true } })
  })

  it('refuses a call the user denies without sending it again', async () => {
    native.async.mockResolvedValueOnce(host({ ok: false, error: { code: 'approval_required', challenge: 'c1', prompt } }))
    await expect(executor(null).run.callTool({ tool: 't', args: {} }, signal)).rejects.toMatchObject({ code: 'denied' })
    expect(native.async).toHaveBeenCalledTimes(1)
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
    native.async.mockResolvedValueOnce(host({ ok: false, error: { code: 'approval_required', challenge: 'c2', prompt: { kind: 'sendMessage', server: 'fixture', text: 'hi', nonTextBlocks: 0 } } }))
    await expect(executor(null).run.sendMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }] }, signal)).resolves.toEqual({ isError: true })
    expect(native.async).toHaveBeenCalledTimes(1)
  })

  it('opens links on the phone only after its own confirmation', async () => {
    await expect(executor(null, false).run.openLink({ url: 'https://example.com' }, signal)).resolves.toEqual({ isError: true })
    expect(native.fire).not.toHaveBeenCalled()
    await executor().run.openLink({ url: 'https://example.com' }, signal)
    expect(native.fire).toHaveBeenCalledWith('openLink', { url: 'https://example.com' })
  })
})
