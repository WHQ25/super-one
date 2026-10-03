import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { resolveMcpAppOpenFile } from './open-file'
import type { McpAppHostRequest, McpAppHostResult, McpAppRequester, ToolAppAttachment } from '@superone/shared/mcp-apps'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** `<tmp>/project/part.stl`, `<tmp>/outside/part.stl` and a project link to the outside file. */
function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-open-file-')))
  roots.push(root)
  const project = join(root, 'project'), outside = join(root, 'outside')
  mkdirSync(project); mkdirSync(outside)
  writeFileSync(join(project, 'part.stl'), 'solid inside')
  writeFileSync(join(outside, 'part.stl'), 'solid outside')
  symlinkSync(join(outside, 'part.stl'), join(project, 'link.stl'))
  return { project, outside }
}

describe('resolveMcpAppOpenFile', () => {
  it('reports files inside the project, and resolves links to where they point', async () => {
    const { project, outside } = tree()
    await expect(resolveMcpAppOpenFile(project, join(project, 'part.stl'))).resolves.toEqual({ path: join(project, 'part.stl'), insideProject: true })
    await expect(resolveMcpAppOpenFile(project, join(project, 'link.stl'))).resolves.toEqual({ path: join(outside, 'part.stl'), insideProject: false })
    await expect(resolveMcpAppOpenFile(project, join(project, '..', 'outside', 'part.stl'))).resolves.toMatchObject({ insideProject: false })
  })

  it('refuses missing paths and directories', async () => {
    const { project } = tree()
    await expect(resolveMcpAppOpenFile(project, join(project, 'missing.stl'))).rejects.toMatchObject({ code: 'invalid' })
    await expect(resolveMcpAppOpenFile(project, project)).rejects.toMatchObject({ code: 'invalid' })
  })
})

const APP: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad/viewer', status: 'result' }
const DESKTOP: McpAppRequester = { kind: 'desktop' }

function setup(project: string, node = 'local') {
  const target: McpAppResolvedTarget = { ref: { environmentId: 'local', sessionId: 's' }, node, projectPath: project, messageId: 'm', app: { ...APP, binding: { ...APP.binding, node } } }
  const ports: McpAppExecutorPorts = {
    resolve: vi.fn(async () => target), persist: vi.fn(), sendMessage: vi.fn(),
    provider: vi.fn(async () => { throw new Error('opening a file needs no provider') }),
    openFile: vi.fn((t, path) => resolveMcpAppOpenFile(t.projectPath, path)),
  }
  const executor = new McpAppExecutor(ports)
  executor.observeLive(target.ref, target.app)
  const run = (path: string, approval?: McpAppHostRequest['approval'], requester = DESKTOP) =>
    executor.execute({ sessionKey: 'local:s', appInstanceId: 'view', messageId: 'm', operation: 'openFile', path, ...(approval ? { approval } : {}) }, requester, new AbortController().signal)
  return { executor, ports, run, target }
}

function challenge(result: McpAppHostResult): string {
  if (result.ok || result.error.code !== 'approval_required') throw new Error(`Expected approval, got ${JSON.stringify(result)}`)
  return result.error.challenge
}

describe('MCP App host executor: openFile', () => {
  it('opens a project file without asking or reaching the provider', async () => {
    const { project } = tree()
    const s = setup(project)
    await expect(s.run(join(project, 'part.stl'))).resolves.toEqual({ ok: true, value: { path: join(project, 'part.stl') } })
    expect(s.ports.provider).not.toHaveBeenCalled()
  })

  it('confirms a file outside the project once, showing its real path', async () => {
    const { project, outside } = tree()
    const s = setup(project)
    const prompt = await s.run(join(project, 'link.stl'))
    expect(prompt).toMatchObject({ ok: false, error: { prompt: { kind: 'openFile', server: 'cad', path: join(outside, 'part.stl') } } })
    const id = challenge(prompt)
    await expect(s.run(join(project, 'link.stl'), { challenge: id })).resolves.toEqual({ ok: true, value: { path: join(outside, 'part.stl') } })
    await expect(s.run(join(project, 'link.stl'), { challenge: id })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('does not let an approval follow a link that changed after the prompt', async () => {
    const { project, outside } = tree()
    const s = setup(project)
    const id = challenge(await s.run(join(project, 'link.stl')))
    writeFileSync(join(outside, 'other.stl'), 'solid other')
    rmSync(join(project, 'link.stl'))
    symlinkSync(join(outside, 'other.stl'), join(project, 'link.stl'))
    await expect(s.run(join(project, 'link.stl'), { challenge: id })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
  })

  it('refuses relative paths, the phone, remote sessions and restored Views', async () => {
    const { project } = tree()
    const s = setup(project)
    await expect(s.run('part.stl')).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await s.run(join(project, 'part.stl'), undefined, { kind: 'mobile', deviceId: 'phone' }).then(result => expect(result).toMatchObject({ ok: false, error: { code: 'inactive' } }))
    s.executor.observeLive(s.target.ref, s.target.app, { kind: 'mobile', deviceId: 'phone' })
    await expect(s.run(join(project, 'part.stl'), undefined, { kind: 'mobile', deviceId: 'phone' })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    const remote = setup(project, 'node-1')
    await expect(remote.run(join(project, 'part.stl'))).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    const restored = setup(project)
    restored.executor.releaseSession(restored.target.ref)
    await expect(restored.run(join(project, 'part.stl'))).resolves.toMatchObject({ ok: false, error: { code: 'inactive' } })
    expect(s.ports.openFile).toHaveBeenCalledTimes(0)
  })
})
