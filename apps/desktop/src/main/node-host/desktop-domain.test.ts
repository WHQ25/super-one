import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RecentFolder } from '@superone/shared/agent-types'
import { ALL_AUTH_SCOPES, type EnvironmentEventEnvelope, type ExecutionEnvironmentDescriptor } from '@superone/shared/environment'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'
import { dispatchRpc, type RpcContext } from '@superone/runtime/server'

vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { createDesktopProjectsPort } from './desktop-projects-port'
import { DesktopDomain } from './desktop-domain'
import { AGENT_PROFILES, FakeSessionManager, memoryStore, type FakeSession } from './node-host-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The domain over one project with one session this desktop's user runs, and the RPCs a phone makes. */
function phoneDomain() {
  const projectDir = tempDir('superone-domain-project-')
  execFileSync('git', ['init', '-q', projectDir])
  const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
  const domain = DesktopDomain.open({
    userDataDir: tempDir('superone-domain-'), appVersion: '0.0.0-test', sessions, store, rows: store.all, projects, harnesses,
    listAgentProfiles: () => AGENT_PROFILES,
    hooks: { probeHarnessReadiness: () => ({ ok: true }) as never, assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }) },
  })
  cleanup.push(() => domain.close())
  store.createRow({ sessionId: 'own', projectPath: projectDir, title: 'Mine', cwd: projectDir })
  const own = sessions.createSession({ id: 'own', projectPath: projectDir }) as unknown as FakeSession
  const ctx = {
    ...domain.phoneContext(),
    client: { clientSessionId: 'phone:p1', scopes: [...ALL_AUTH_SCOPES], devicePublicKeyFingerprint: 'fp', devicePublicKeyPem: 'pem' },
  } as RpcContext
  const rpc = async <T>(method: string, payload: unknown = {}) => {
    const res = await dispatchRpc(method, payload, { ...ctx, idempotencyKey: `${method}-${Math.random()}` })
    if (res.error) throw Object.assign(new Error(res.error.message), res.error)
    return res.result as T
  }
  return { rpc, own, domain, projectDir }
}

describe('DesktopDomain for phones', () => {
  it('serves every session of the desktop to read, with its recorded events', async () => {
    const { rpc, own } = phoneDomain()
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)

    expect((await rpc<Array<{ sessionId: string }>>('session.list', { projectId: 'p1', limit: 10, offset: 0 })).map((s) => s.sessionId)).toEqual(['own'])
    expect(await rpc('session.get', { sessionId: 'own' })).toMatchObject({ sessionId: 'own', title: 'Mine', controllerClientSessionId: null })
    expect(await rpc('session.load', { sessionId: 'own' })).toMatchObject({ sessionId: 'own', cursor: { version: 1 } })
    const { events } = await rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    expect(events.map((e) => e.aggregateId)).toEqual(['own'])
  })

  it('leaves out and refuses local session changes until sessions move onto leases', async () => {
    const { rpc } = phoneDomain()
    const { capabilities } = await rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(capabilities.methods).toEqual(expect.arrayContaining(['session.list', 'session.load', 'topic.subscribe']))
    for (const method of ['session.send', 'session.create', 'session.acquireControl']) expect(capabilities.methods).not.toContain(method)
    await expect(rpc('session.send', { sessionId: 'own', text: 'hi' })).rejects.toMatchObject({ details: { unsupported: true } })
  })

  it('gives phones the workspace files and Git, which controllers do not get', async () => {
    const { rpc, domain, projectDir } = phoneDomain()
    writeFileSync(join(projectDir, 'readme.md'), 'hello')
    const listed = await rpc<Array<{ name: string }>>('workspace.listDir', { projectId: 'p1', relativePath: '.' })
    expect(listed.map((e) => e.name)).toContain('readme.md')
    expect(await rpc('git.status', { projectId: 'p1' })).toMatchObject({ isRepo: true })
    const controller = await dispatchRpc('environment.descriptor', {}, { ...domain.rpcContext(), client: { clientSessionId: 'c', scopes: [...ALL_AUTH_SCOPES] } } as RpcContext)
    const methods = (controller.result as ExecutionEnvironmentDescriptor).capabilities.methods
    for (const method of ['workspace.listDir', 'git.status']) expect(methods).not.toContain(method)
  })
})
