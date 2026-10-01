import { describe, expect, it, vi } from 'vitest'
import { McpAppsError, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { requestOpenExternalLink } from '@/lib/external-link'
vi.mock('@/lib/external-link', () => ({ requestOpenExternalLink: vi.fn() }))
import { createDesktopMcpAppExecutor, type McpAppDesktopApi } from './desktop-executor'

const app: ToolAppAttachment = { appInstanceId: 'v', binding: { node: 'remote-node', session: 'original', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, resourceUri: 'ui://fixture/view', status: 'result' }
function setup(navigate?: (route: { projectPath: string; sessionId: string }) => Promise<void>) {
  const api = { mcpAppRequest: vi.fn(), mcpAppCancel: vi.fn(async () => {}) } as unknown as McpAppDesktopApi
  const consent = vi.fn(async () => ({} as Record<string, never> | null))
  const executor = createDesktopMcpAppExecutor({ api, route: { projectPath: 'remote:connection:/project', sessionId: 'original' }, app, document: { id: 'document', url: '', origin: '', appInstanceId: 'v' }, consent, displayMode: async mode => mode, navigate })
  return { api, consent, executor, request: vi.mocked(api.mcpAppRequest) }
}
describe('desktop MCP App host adapter', () => {
  it('switches before sending a confirmed new-session handoff, even when the old View unmounts', async () => {
    const signal = new AbortController()
    const order: string[] = []
    const s = setup(async destination => { expect(destination.sessionId).toBe('new'); order.push('switch'); signal.abort() })
    s.request.mockImplementation(async (_project, _sid, request, context) => {
      if (request.operation === 'sendMessage') return { ok: true, value: { pendingSend: 'token', route: { projectPath: 'remote:connection:/project', sessionId: 'new' } } }
      expect(context).toBeUndefined()
      expect(request).toMatchObject({ operation: 'sendPreparedMessage', pendingSend: 'token' })
      order.push('send')
      return { ok: true, value: {} }
    })
    await s.executor.sendMessage({ role: 'user', content: [], _meta: { 'openai/message': { target: 'new' } } }, signal.signal)
    expect(order).toEqual(['switch', 'send'])
  })
  it('routes links to the existing link UI without invoking the main executor', async () => {
    const s = setup()
    await s.executor.openLink({ url: 'https://example.com/' }, new AbortController().signal)
    expect(requestOpenExternalLink).toHaveBeenCalledWith('https://example.com/')
    expect(s.request).not.toHaveBeenCalled(); expect(s.consent).not.toHaveBeenCalled()
  })
  it('dispatches View tools once without approval on their original binding', async () => {
    const s = setup()
    s.request.mockResolvedValue({ ok: true, value: { result: { content: [] }, outcome: 'completed' } })
    await s.executor.callTool({ tool: 'next', args: { page: 2 } }, new AbortController().signal)
    expect(s.request.mock.calls[0].slice(0, 3)).toEqual(['remote:connection:/project', 'original', { appInstanceId: 'v', operation: 'callTool', tool: 'next', args: { page: 2 } }])
    expect(s.request).toHaveBeenCalledOnce(); expect(s.consent).not.toHaveBeenCalled()
  })
  it('confirms the exact View-authored message once', async () => {
    const s = setup()
    const prompt = { kind: 'sendMessage', server: 'fixture', text: 'Selected 2', nonTextBlocks: 0 } as const
    s.request.mockResolvedValueOnce({ ok: false, error: { code: 'approval_required', challenge: 'challenge', prompt } }).mockResolvedValueOnce({ ok: true, value: {} })
    await s.executor.sendMessage({ role: 'user', content: [{ type: 'text', text: 'Selected 2' }] }, new AbortController().signal)
    expect(s.request.mock.calls[1][2]).toEqual({ ...s.request.mock.calls[0][2], approval: { challenge: 'challenge' } })
    expect(s.request.mock.calls[1][3]).toEqual(s.request.mock.calls[0][3])
  })
  it('declines without dispatch and preserves structured auth errors', async () => {
    const s = setup()
    s.request.mockResolvedValue({ ok: false, error: { code: 'approval_required', challenge: 'c', prompt: { kind: 'sendMessage', server: 'fixture', text: '<script>plain</script>', nonTextBlocks: 1 } } })
    s.consent.mockResolvedValue(null)
    await expect(s.executor.sendMessage({ role: 'user', content: [{ type: 'text', text: 'go' }] }, new AbortController().signal)).rejects.toMatchObject({ code: 'denied' })
    expect(s.request).toHaveBeenCalledTimes(1)
    s.request.mockResolvedValue({ ok: false, error: { code: 'auth_required', message: 'login' } })
    await expect(s.executor.callTool({ tool: 'next', args: {} }, new AbortController().signal)).rejects.toBeInstanceOf(McpAppsError)
  })
  it('cancels native work by document and request and never replays ambiguous calls', async () => {
    const s = setup(); const controller = new AbortController()
    s.request.mockImplementation(async () => { controller.abort(); return { ok: true, value: { content: [] } } })
    await expect(s.executor.readResource({ uri: 'ui://fixture/view' }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(s.api.mcpAppCancel).toHaveBeenCalledWith(s.request.mock.calls[0][3])
    s.request.mockRejectedValue(new Error('IPC disconnected'))
    expect(await s.executor.callTool({ tool: 'mutate', args: {} }, new AbortController().signal)).toMatchObject({ outcome: 'unknown_outcome' })
    expect(s.request).toHaveBeenCalledTimes(2)
    s.request.mockResolvedValue({ ok: false, error: { code: 'unknown_outcome', message: 'transport lost' } })
    expect(await s.executor.callTool({ tool: 'mutate', args: {} }, new AbortController().signal)).toMatchObject({ outcome: 'unknown_outcome' })
    expect(s.request).toHaveBeenCalledTimes(3)
  })
})
