import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels, type McpServerConfig, type PermissionRequest } from '@superone/shared/agent-types'
import { acceptedElicitationContent, elicitationFormRequest } from '@superone/shared/schema-form'
import { MCP_APP_OUTPUT_MAX_BYTES, type McpAppsProvider } from '@superone/shared/mcp-apps'
import type { Session } from '../session/types'
import { createCodexSession } from '../codex/codex-session'

const mocks = vi.hoisted(() => ({ configs: [] as McpServerConfig[], handlers: new Map<string, (...args: any[]) => any>(), dialog: vi.fn() }))
vi.mock('../codex-config-service', () => ({ listCodexMcpConfigs: () => mocks.configs }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: mocks.dialog }, ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) } }))
const { codexFormResources, codexFormWithPickedResources, prepareCodexFormResources } = await import('../codex/codex-form-resources')
const { pickFormResources, previewFormResource, registerMcpFormResourceIpc } = await import('./form-resources-ipc')

const disposers: Array<() => void> = []
let directory: string
const event = { senderFrame: 'main', sender: { mainFrame: 'main' } }

function fixture(input: Record<string, unknown> = {}, single = false) {
  const schema = { type: 'object', required: ['files'], properties: {
    files: { ...(single ? { type: 'string', format: 'uri' } : { type: 'array', items: { type: 'string', format: 'uri' } }),
      'x-openai-input': { type: 'resource', options: [{ uri: 'cad://a', name: 'a', _meta: { 'openai/preview': { target: { type: 'resource_link', uri: 'cad://preview/a', name: 'preview' } } } }], userOptions: {}, ...input } },
    other: { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', options: [], userOptions: {} } },
  } }
  const session = createCodexSession('s', '/work', undefined, 'root')
  const request: PermissionRequest = { requestId: 'r', requestKind: 'mcp_elicitation', toolName: 'bits', serverName: 'bits', input: {}, allowAlwaysAllow: false, ...elicitationFormRequest(schema) }
  const register = prepareCodexFormResources(session, { method: 'mcpServer/elicitation/request', requestIdRaw: 0, params: { requestedSchema: schema, threadId: 'child' } }, request)
  session.pendingApprovals.set('r', { responseKind: 'elicitation', event: { type: 'permission_request', request }, resolve: vi.fn(), reject: vi.fn() })
  if (register) disposers.push(register())
  return { session, request, context: register ? codexFormResources('s', 'r') : undefined }
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'superone-form-resources-')))
  mocks.configs = [{ name: 'bits', type: 'stdio', command: 'fixture', scope: 'project' }]
  mocks.handlers.clear(); mocks.dialog.mockReset()
})
afterEach(async () => { disposers.splice(0).forEach(dispose => dispose()); await rm(directory, { recursive: true, force: true }) })

describe('pending form resource authority', () => {
  it('captures the eliciting server/thread, enables local stdio picking, and cleans up after settlement', () => {
    const { session, request, context } = fixture({ selection: 'implicit' })
    expect(context).toMatchObject({ localFiles: true, binding: { server: 'bits', session: 's' }, origin: { providerSessionId: 'child' } })
    expect(request.schemaForm).toMatchObject({ supported: true, fields: expect.arrayContaining([expect.objectContaining({ selection: 'implicit', userOptions: { kind: 'file' } })]) })
    session.pendingApprovals.clear()
    expect(() => codexFormResources('s', 'r')).toThrow('binding changed')
    disposers.splice(0).forEach(dispose => dispose())
    expect(context!.signal.aborted).toBe(true)
    expect(() => codexFormResources('s', 'r')).toThrow('no longer pending')
  })
  it('does not enable user paths on HTTP servers or unconfigured servers', () => {
    mocks.configs = [{ name: 'bits', type: 'http', url: 'https://example.test', scope: 'project' }]
    expect(fixture({ selection: 'implicit' }).request.schemaForm?.supported).toBe(false)
    expect(codexFormResources('s', 'r').localFiles).toBe(false)
    mocks.configs = []
    expect(fixture().context).toBeUndefined()
  })
  it.each(['configuration', 'account', 'thread', 'cwd'] as const)('invalidates changed %s before accepting trusted resources', change => {
    const { session, request } = fixture()
    if (change === 'configuration') mocks.configs[0].command = 'other'
    if (change === 'account') session.apiProviderId = 'other'
    if (change === 'thread') session.threadId = 'other'
    if (change === 'cwd') session.effectiveCwd = '/other'
    expect(() => codexFormWithPickedResources('s', 'r', request.schemaForm)).toThrow('binding changed')
  })
})

describe('native user resource selection', () => {
  it('adds only dialog-picked canonical file URIs to this field and keeps forged/cross-field paths invalid', async () => {
    const file = path.join(directory, 'part with space.STL'); await writeFile(file, 'solid part')
    const { request, context } = fixture({ userOptions: { accept: ['.stl'] } })
    const picker = vi.fn(async () => ({ canceled: false, filePaths: [file] }))
    const chosen = await pickFormResources(context!, 'files', picker)
    expect(chosen).toEqual([{ uri: pathToFileURL(file).href, name: 'part with space.STL', mimeType: 'model/stl', size: 10 }])
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile', 'multiSelections'], filters: [{ name: '.stl', extensions: ['stl'] }] }))
    const form = codexFormWithPickedResources('s', 'r', request.schemaForm)
    expect(acceptedElicitationContent(form, { files: [chosen[0].uri] }).ok).toBe(true)
    expect(acceptedElicitationContent(form, { files: ['file:///etc/passwd'] }).ok).toBe(false)
    expect(acceptedElicitationContent(form, { files: ['cad://a'], other: chosen[0].uri }).ok).toBe(false)
  })
  it.each([['.stl', 'part.txt'], ['image/*', 'part.stl']])('enforces %s after the dialog for %s', async (rule, name) => {
    const file = path.join(directory, name); await writeFile(file, 'data')
    const { context } = fixture({ userOptions: { accept: [rule] } })
    await expect(pickFormResources(context!, 'files', async () => ({ canceled: false, filePaths: [file] }))).rejects.toMatchObject({ code: 'denied' })
    expect(context!.picked.size).toBe(0)
  })
  it('enforces MIME wildcards and rejects an extension-matching symlink to a disallowed target', async () => {
    const image = path.join(directory, 'image.png'); await writeFile(image, 'data')
    const { context } = fixture({ userOptions: { accept: ['image/*'] } })
    expect(await pickFormResources(context!, 'files', async () => ({ canceled: false, filePaths: [image] }))).toHaveLength(1)
    const target = path.join(directory, 'target.txt'); await writeFile(target, 'data')
    const link = path.join(directory, 'link.png'); await symlink(target, link)
    await expect(pickFormResources(context!, 'files', async () => ({ canceled: false, filePaths: [link] }))).rejects.toMatchObject({ code: 'denied' })
  })
  it('supports directory selection without recursively reading it', async () => {
    const folder = path.join(directory, 'parts'); await mkdir(folder)
    const { context } = fixture({ userOptions: { kind: 'directory' } })
    expect(await pickFormResources(context!, 'files', async options => {
      expect(options.properties).toEqual(['openDirectory', 'multiSelections'])
      return { canceled: false, filePaths: [folder] }
    })).toEqual([{ uri: pathToFileURL(folder).href, name: 'parts' }])
  })
  it('does not record cancelled picks and rejects settlement/config changes while the dialog is open', async () => {
    const { session, context } = fixture()
    expect(await pickFormResources(context!, 'files', async () => ({ canceled: true, filePaths: [] }))).toEqual([])
    expect(context!.picked.get('files')).toBeUndefined()
    await expect(pickFormResources(context!, 'files', async () => {
      session.pendingApprovals.clear()
      return { canceled: false, filePaths: [] }
    })).rejects.toMatchObject({ code: 'inactive' })
    expect(context!.picking).toBe(false)
  })
  it('rejects simultaneous native dialogs and never calls a picker for HTTP', async () => {
    const { context } = fixture(); context!.picking = true
    const pick = vi.fn()
    await expect(pickFormResources(context!, 'files', pick)).rejects.toMatchObject({ code: 'denied' })
    context!.picking = false; context!.localFiles = false
    await expect(pickFormResources(context!, 'files', pick)).rejects.toMatchObject({ code: 'denied' })
    expect(pick).not.toHaveBeenCalled()
  })
})

describe('resource_link form preview', () => {
  function providerSession(readResource = vi.fn(async () => ({ contents: [{ uri: 'cad://preview/a', text: 'details' }] }))) {
    const provider = { readResource, dispose: vi.fn() } as unknown as McpAppsProvider
    const getMcpAppsProvider = vi.fn(async () => provider)
    return { session: { getMcpAppsProvider } as unknown as Session, provider, getMcpAppsProvider, readResource }
  }
  it('reads only the declared target using its original server/thread and the native transient path', async () => {
    const { context } = fixture(); const source = providerSession()
    expect(await previewFormResource(source.session, context!, 'files', 'cad://a')).toMatchObject({ contents: [{ text: 'details' }] })
    expect(source.getMcpAppsProvider).toHaveBeenCalledWith(context!.binding, { providerSessionId: 'child' })
    expect(source.readResource).toHaveBeenCalledWith({ uri: 'cad://preview/a', origin: context!.origin, transient: true }, context!.signal)
    expect(source.provider.dispose).toHaveBeenCalledOnce()
  })
  it('rejects arbitrary field/option targets and mcp_app_tool previews before calling the provider', async () => {
    const { context } = fixture(); const source = providerSession()
    for (const [field, uri] of [['forged', 'cad://a'], ['files', 'file:///etc/passwd']]) {
      await expect(previewFormResource(source.session, context!, field, uri)).rejects.toMatchObject({ code: 'denied' })
    }
    const form = context!.request.schemaForm
    if (form?.supported && form.fields[0].kind === 'resource') form.fields[0].options[0].preview = { type: 'mcp_app_tool', name: 'dangerous', arguments: {} }
    await expect(previewFormResource(source.session, context!, 'files', 'cad://a')).rejects.toMatchObject({ code: 'denied' })
    expect(source.getMcpAppsProvider).not.toHaveBeenCalled()
  })
  it('drops a late preview after settlement and disposes its provider', async () => {
    const { session, context } = fixture()
    const source = providerSession(vi.fn(async () => { session.pendingApprovals.clear(); return { contents: [{ uri: 'cad://preview/a', text: 'late' }] } }))
    await expect(previewFormResource(source.session, context!, 'files', 'cad://a')).rejects.toMatchObject({ code: 'inactive' })
    expect(source.provider.dispose).toHaveBeenCalledOnce()
  })
  it('adds no local IPC cap beyond the native provider result', async () => {
    const { context } = fixture()
    const result = { contents: [{ uri: 'cad://preview/a', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES + 1) }] }
    const source = providerSession(vi.fn(async () => result))
    expect(await previewFormResource(source.session, context!, 'files', 'cad://a')).toBe(result)
  })
  it('refuses subframe requests and never opens a dialog for a forged/settled request', async () => {
    registerMcpFormResourceIpc(() => null)
    const handler = mocks.handlers.get(AgentIpcChannels.MCP_FORM_PICK_RESOURCES)!
    expect(await handler({ senderFrame: 'iframe', sender: { mainFrame: 'main' } }, 's', 'r', 'files')).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(await handler(event, 's', 'forged', 'files')).toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(mocks.dialog).not.toHaveBeenCalled()
  })
})
