import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts } from './executor-core'
import { McpAppsError, MCP_APP_MIME_TYPE, type ToolAppAttachment } from '@superone/shared/mcp-apps'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function setup() {
  const apps = new Map<string, ToolAppAttachment>()
  let html = 'version one'
  const read = vi.fn(async (app: ToolAppAttachment) => ({ contents: [{ uri: app.resourceUri, mimeType: MCP_APP_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: true } } }] }))
  const provider = vi.fn<McpAppExecutorPorts['provider']>(async (target, operation) => ({ ok: true, value: operation.operation === 'readResource' ? await read(target.app) : operation.operation === 'tools' ? [] : { mode: 'native', resourceRead: true, toolCall: true } }))
  const persist = vi.fn<McpAppExecutorPorts['persist']>(async (target, update) => { apps.set(target.app.appInstanceId, { ...apps.get(target.app.appInstanceId)!, ...update }) })
  const ports: McpAppExecutorPorts = { provider, persist, resolve: async (ref, id) => ({ ref, node: apps.get(id)!.binding.node, projectPath: '/project', messageId: id, app: apps.get(id)! }), sendMessage: async () => {} }
  const executor = new McpAppExecutor(ports)
  const add = (id: string, overrides: Partial<ToolAppAttachment> = {}, active = true) => {
    const app: ToolAppAttachment = { appInstanceId: id, status: 'result', binding: { node: 'local', session: 's', server: 'CAD', account: 'account', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread', originCallId: id }, resourceUri: 'ui://cad', ...overrides }
    apps.set(id, app)
    if (active) executor.observeLive({ environmentId: 'local', sessionId: app.binding.session }, app)
    return app
  }
  const load = (id: string, referenceOnly = false) => executor.execute({ sessionKey: `local:${apps.get(id)!.binding.session}`, appInstanceId: id, operation: 'load', ...(referenceOnly ? { referenceOnly } : {}) }, { kind: 'desktop' }, new AbortController().signal)
  return { add, load, apps, read, provider, persist, ports, executor, setHtml: (text: string) => { html = text } }
}

describe('executor resource snapshot cache', () => {
  it('single-flights concurrent first loads across fresh Views in the same provider origin', async () => {
    const s = setup(); s.add('a'); s.add('b')
    expect(await Promise.all([s.load('a'), s.load('b')])).toMatchObject([{ ok: true, value: { html: 'version one' } }, { ok: true, value: { html: 'version one' } }])
    expect(s.read).toHaveBeenCalledOnce()
  })
  it('paints cached HTML before revalidation completes, and never swaps an old View/history hash', async () => {
    const s = setup(); s.add('a'); await s.load('a')
    let complete!: (value: Awaited<ReturnType<typeof s.read>>) => void
    s.read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    s.add('b'); expect(await s.load('b')).toMatchObject({ value: { html: 'version one' } })
    complete({ contents: [{ uri: 'ui://cad', mimeType: MCP_APP_MIME_TYPE, text: 'version two' }] })
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    s.setHtml('version two'); s.add('c')
    expect(await s.load('c')).toMatchObject({ value: { html: 'version two' } })
    expect(await s.load('a')).toMatchObject({ value: { html: 'version one' } })
    expect(s.apps.get('b')?.resource?.hash).toBe(hash('version one'))
  })
  it('never shares resource reads across accounts/config/thread/session origins', async () => {
    const s = setup(); const a = s.add('a'); await s.load('a')
    s.setHtml('other origin')
    for (const [id, fields] of Object.entries({ account: { binding: { ...a.binding, account: 'other' } }, config: { binding: { ...a.binding, configFingerprint: 'other' } }, thread: { origin: { providerSessionId: 'other' } }, session: { binding: { ...a.binding, session: 'other' } } })) {
      s.add(id, fields); expect(await s.load(id)).toMatchObject({ value: { html: 'other origin' } })
    }
    expect(s.read).toHaveBeenCalledTimes(5)
  })
  it('hydrates saved references without provider activation, and reference-only requests never return HTML', async () => {
    const s = setup(); s.add('saved', { resource: { hash: hash('fixed'), meta: {} } }, false)
    s.ports.hydrateResource = vi.fn(async () => ({ hash: hash('fixed'), meta: {}, html: 'fixed' }))
    expect(await s.load('saved', true)).toEqual({ ok: true, value: { hash: hash('fixed'), meta: {} } })
    expect(s.ports.hydrateResource).not.toHaveBeenCalled()
    expect(await s.load('saved')).toMatchObject({ value: { html: 'fixed' } })
    expect(s.provider).not.toHaveBeenCalled()
    s.add('new'); expect(await s.load('new', true)).toMatchObject({ value: { hash: hash('version one') } })
    expect((await s.load('new', true)) as object).not.toHaveProperty('value.html')
  })
  it('treats corrupt/missing blobs as missing, refetches only after Activate, and refuses a different historical version', async () => {
    for (const changed of [false, true]) {
      const s = setup(); const app = s.add('saved', { resource: { hash: hash('version one'), meta: { prefersBorder: false } } }, false)
      s.ports.hydrateResource = async () => { throw new McpAppsError('invalid', 'Saved MCP App HTML hash does not match') }
      expect(await s.load('saved')).toMatchObject({ ok: false, error: { code: 'inactive' } }); expect(s.read).not.toHaveBeenCalled()
      await s.executor.execute({ sessionKey: 'local:s', appInstanceId: app.appInstanceId, operation: 'activate' }, { kind: 'desktop' }, new AbortController().signal)
      if (changed) s.setHtml('different')
      const result = await s.load('saved')
      expect(result).toMatchObject(changed ? { ok: false, error: { code: 'invalid' } } : { ok: true, value: { html: 'version one', meta: { prefersBorder: false } } })
      if (changed) expect(s.persist).not.toHaveBeenCalled()
    }
  })
})
