/**
 * session.listPinned — the cross-project pinned list behind the desktop
 * sidebar's Pinned section when a remote host is selected.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type PinnedRow = {
  sessionId: string
  projectId: string
  projectPath: string
  projectName: string
  isPinned?: boolean
}

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'pin-node-'))
  dirs.push(nodeHome)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: 0,
    simulatedHarness: true,
  })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)

  async function openProject(name: string) {
    const dir = mkdtempSync(join(tmpdir(), `pin-${name}-`))
    dirs.push(dir)
    return (await client.rpc('project.open', { path: dir, name })) as {
      projectId: string
      path: string
    }
  }

  async function createSession(projectId: string) {
    const created = (await client.rpc(
      'session.create',
      { projectId, harnessId: 'claude' },
      crypto.randomUUID(),
    )) as { sessionId: string }
    return created.sessionId
  }

  const listPinned = async () => (await client.rpc('session.listPinned', {})) as PinnedRow[]

  return { client, openProject, createSession, listPinned }
}

describe('session.listPinned', () => {
  it('spans every project and resolves each row to its project path and name', async () => {
    const { client, openProject, createSession, listPinned } = await boot()
    const alpha = await openProject('alpha')
    const beta = await openProject('beta')
    const alphaSession = await createSession(alpha.projectId)
    const betaSession = await createSession(beta.projectId)
    await createSession(beta.projectId) // left unpinned

    expect(await listPinned()).toEqual([])

    await client.rpc('session.setUiFlags', { sessionId: alphaSession, isPinned: true })
    await client.rpc('session.setUiFlags', { sessionId: betaSession, isPinned: true })

    const rows = await listPinned()
    expect(rows.map((r) => r.sessionId).sort()).toEqual([alphaSession, betaSession].sort())
    // Rows carry the project identity so the client never needs a second lookup
    // to build its `remote:<connectionId>:<path>` key.
    const byId = new Map(rows.map((r) => [r.sessionId, r]))
    expect(byId.get(alphaSession)?.projectPath).toBe(alpha.path)
    expect(byId.get(alphaSession)?.projectName).toBe('alpha')
    expect(byId.get(betaSession)?.projectPath).toBe(beta.path)
  })

  it('drops a session once it is unpinned or hidden', async () => {
    const { client, openProject, createSession, listPinned } = await boot()
    const project = await openProject('alpha')
    const kept = await createSession(project.projectId)
    const unpinned = await createSession(project.projectId)
    const hidden = await createSession(project.projectId)

    for (const sessionId of [kept, unpinned, hidden]) {
      await client.rpc('session.setUiFlags', { sessionId, isPinned: true })
    }
    expect((await listPinned()).length).toBe(3)

    await client.rpc('session.setUiFlags', { sessionId: unpinned, isPinned: false })
    // A hidden session stays pinned in the DB but must not surface — the same
    // rule the local SQLite query applies.
    await client.rpc('session.setUiFlags', { sessionId: hidden, isHidden: true })

    expect((await listPinned()).map((r) => r.sessionId)).toEqual([kept])
  })
})
