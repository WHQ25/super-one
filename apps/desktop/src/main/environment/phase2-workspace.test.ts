import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    available: true,
  }
})

vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => electron.available,
    encryptString: (s: string) => {
      const id = `x-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (!v) throw new Error('missing')
      return v
    },
  },
}))

import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { NodeConnectionManager } from './node-connection-manager'
import { NodeCredentialStore } from './node-credential-store'
import { WorkspaceRouter } from './workspace-router'
import { listRemoteFileTreeDir, readRemoteProjectFile, saveRemoteProjectFile, renameRemoteFile, moveRemoteFile, deleteRemoteFile, createRemoteEntry, getRemoteGitDiffFile } from './remote-file-tree'
import type { EnvironmentHost } from './environment-host'
import { searchRemoteFiles } from './remote-mentions'
import type { RemoteEnvironmentGateway } from './remote-environment-gateway'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop()
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

describe('Phase 2 remote workspace routing', () => {
  it('browses and edits a task checkout without registering another project or reading local files', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p2-node-'))
    const desk = mkdtempSync(join(tmpdir(), 'p2-desk-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'p2-proj-'))
    dirs.push(nodeHome, desk, projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'alpha')
    execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' })

    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true })
    runtimes.push(rt)

    const store = new NodeCredentialStore(desk)
    const manager = new NodeConnectionManager({ credentialStore: store })
    const pair = rt.auth.createPairingToken()
    const { descriptor } = await manager.pairAndConnect({
      baseUrl: rt.server.url,
      pairingToken: pair.token,
      label: 'remote',
    })

    const localFsCalls: string[] = []
    const router = new WorkspaceRouter(
      (id) => manager.getGateway(id),
      {
        listDir: async () => {
          localFsCalls.push('listDir')
          return []
        },
        readFile: async () => {
          localFsCalls.push('readFile')
          return { content: '' }
        },
      },
    )

    const gateway = manager.getGateway(descriptor.environmentId) as RemoteEnvironmentGateway
    const project = await gateway.openProject(projectDir, 'p')
    const projectRef = { environmentId: descriptor.environmentId, projectId: project.projectId }

    const entries = await router.listDir({ project: projectRef, relativePath: '.' })
    expect(entries.some((e) => e.name === 'a.txt')).toBe(true)

    const file = await router.readFile({ project: projectRef, relativePath: 'a.txt' })
    const text =
      typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8')
    expect(text).toBe('alpha')

    await router.writeFile({ project: projectRef, relativePath: 'b.txt', content: 'beta' })
    const hits = await router.search({ project: projectRef, query: 'beta' })
    expect(hits.some((h) => h.path.includes('b.txt'))).toBe(true)

    const status = await gateway.gitStatus(project.projectId)
    expect((status as { isRepo: boolean }).isRepo).toBe(true)

    // Critical: local FS probe never invoked for remote project refs
    expect(localFsCalls).toEqual([])

    // Opening a suggested task reads its linked checkout through these APIs.
    execFileSync('git', ['-C', projectDir, 'add', 'a.txt'])
    execFileSync('git', ['-C', projectDir, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'init'])
    const worktree = mkdtempSync(join(tmpdir(), 'p2-task-'))
    dirs.push(worktree)
    execFileSync('git', ['-C', projectDir, 'worktree', 'add', '-qb', 'suggested-task', worktree])
    writeFileSync(join(worktree, 'a.txt'), 'task checkout')
    writeFileSync(join(worktree, 'task-only.txt'), 'task file')
    const host = {
      connections: { listKnown: () => [{ connectionId: 'test-node', environmentId: descriptor.environmentId }] },
      listProjects: () => gateway.listProjects(),
      openProject: vi.fn((_connection: string, path: string) => gateway.openProject(path)),
      getGateway: () => gateway,
      workspace: () => router,
    } as unknown as EnvironmentHost
    const taskRoot = `remote:test-node:${worktree}`
    const before = await gateway.listProjects()
    expect((await listRemoteFileTreeDir(host, taskRoot, ''))?.some(e => e.name === 'task-only.txt')).toBe(true)
    expect(host.openProject).not.toHaveBeenCalled()
    expect((await gateway.listProjects()).map(p => p.projectId)).toEqual(before.map(p => p.projectId))
    expect(await readRemoteProjectFile(host, taskRoot, 'a.txt')).toMatchObject({ content: 'task checkout' })
    expect((await searchRemoteFiles(host, taskRoot, 'task-only'))?.some(e => e.path === 'task-only.txt')).toBe(true)
    expect((await getRemoteGitDiffFile(host, taskRoot, 'a.txt', false))?.diff).toContain('+task checkout')
    expect(await saveRemoteProjectFile(host, taskRoot, 'a.txt', 'edited task')).toEqual({ ok: true })
    expect(await createRemoteEntry(host, taskRoot, '', 'src', 'directory')).toEqual({ ok: true })
    expect(await renameRemoteFile(host, taskRoot, 'task-only.txt', 'renamed.txt')).toEqual({ ok: true })
    expect(await moveRemoteFile(host, taskRoot, 'renamed.txt', 'src')).toEqual({ ok: true })
    expect(await deleteRemoteFile(host, taskRoot, 'src/renamed.txt')).toEqual({ ok: true })
    expect(readFileSync(join(projectDir, 'a.txt'), 'utf8')).toBe('alpha')
    expect(readFileSync(join(worktree, 'a.txt'), 'utf8')).toBe('edited task')
    expect(await gateway.listProjects()).toHaveLength(before.length)
    await expect(gateway.workspace.listDir({ project: { ...projectRef, cwd: desk }, relativePath: '.' })).rejects.toThrow()

    manager.disconnectAll()
  })
})
