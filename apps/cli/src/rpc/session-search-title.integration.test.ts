/**
 * session.searchTitle — cross-project title search behind `@session` and
 * plain `@` mentions when a remote host is selected.
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

type TitleRow = {
  sessionId: string
  title: string
  projectPath: string
  projectName: string
}

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'title-node-'))
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
    const dir = mkdtempSync(join(tmpdir(), `title-${name}-`))
    dirs.push(dir)
    return (await client.rpc('project.open', { path: dir, name })) as {
      projectId: string
      path: string
    }
  }

  async function createSession(projectId: string, title: string) {
    const created = (await client.rpc(
      'session.create',
      { projectId, harnessId: 'claude' },
      crypto.randomUUID(),
    )) as { sessionId: string }
    await client.rpc('session.rename', { sessionId: created.sessionId, title })
    return created.sessionId
  }

  const search = (query: string, extra: Record<string, unknown> = {}) =>
    client.rpc('session.searchTitle', { query, ...extra }) as Promise<TitleRow[]>

  return { client, openProject, createSession, search }
}

describe('session.searchTitle', () => {
  it('ranks prefix, word, contains, then subsequence, and keeps recency inside a tier', async () => {
    const { openProject, createSession, search } = await boot()
    const project = await openProject('alpha')
    const olderPrefix = await createSession(project.projectId, 'api gateway')
    const word = await createSession(project.projectId, 'ship api notes')
    const contains = await createSession(project.projectId, 'myapi notes')
    const subsequence = await createSession(project.projectId, 'Align the popup')
    const newerPrefix = await createSession(project.projectId, 'apply the patch')

    const rows = await search('ap')
    expect(rows.map((row) => row.sessionId)).toEqual([newerPrefix, olderPrefix, word, contains, subsequence])
    expect(rows[0]?.projectPath).toBe(project.path)
    expect(rows[0]?.projectName).toBe('alpha')
  })

  it('returns newest non-hidden sessions for an empty query, and can stay inside one project', async () => {
    const { client, openProject, createSession, search } = await boot()
    const alpha = await openProject('alpha')
    const beta = await openProject('beta')
    const older = await createSession(alpha.projectId, 'older note')
    const hidden = await createSession(alpha.projectId, 'hidden note')
    const newer = await createSession(beta.projectId, 'newer note')
    await client.rpc('session.setUiFlags', { sessionId: hidden, isHidden: true })

    const recent = await search('')
    expect(recent.map((row) => row.sessionId)).toEqual([newer, older])

    const scoped = await search('', { projectPaths: [alpha.path] })
    expect(scoped.map((row) => row.sessionId)).toEqual([older])
  })
})
