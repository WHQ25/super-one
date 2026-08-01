import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

vi.mock('electron', () => ({
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
  it('routes FS/Git only through remote gateway and never calls local FS probe', async () => {
    const nodeHome = mkdtempSync(join(tmpdir(), 'p2-node-'))
    const desk = mkdtempSync(join(tmpdir(), 'p2-desk-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'p2-proj-'))
    dirs.push(nodeHome, desk, projectDir)
    writeFileSync(join(projectDir, 'a.txt'), 'alpha')
    execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' })

    const port = 26000 + Math.floor(Math.random() * 10000)
    const rt = await startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: port, simulatedHarness: true })
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

    manager.disconnectAll()
  })
})
