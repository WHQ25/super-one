import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ store: new Map<string, string>(), userData: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `h-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => electron.store.get(buf.toString())!,
  },
  app: { getPath: () => electron.userData },
}))

import type { TurnRunner } from '@superone/runtime/session'
import { startNodeRuntime, type NodeRuntime } from '../../../../../apps/cli/src/runtime'
import { EnvironmentHost, resetEnvironmentHostForTests } from './environment-host'

const dirs: string[] = []
let runtime: NodeRuntime | null = null
let host: EnvironmentHost | null = null

afterEach(async () => {
  host?.dispose()
  host = null
  resetEnvironmentHostForTests()
  await runtime?.stop().catch(() => {})
  runtime = null
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  electron.store.clear()
})

describe('EnvironmentHost remote Claude turn options', () => {
  it('reaches the node runner as the user\'s own turn, with the Ultracode toggle', async () => {
    const [ud, nodeHome, projectDir] = ['eh-uc-ud-', 'eh-uc-node-', 'eh-uc-proj-'].map((prefix) => mkdtempSync(join(tmpdir(), prefix)))
    dirs.push(ud!, nodeHome!, projectDir!)
    electron.userData = ud!

    const seen: Array<Pick<Parameters<TurnRunner>[0], 'source' | 'ultracode'>> = []
    runtime = await startNodeRuntime({
      nodeHome: nodeHome!,
      bindHost: '127.0.0.1',
      bindPort: 0,
      simulatedHarness: true,
      turnRunner: async ({ source, ultracode }) => {
        seen.push({ source, ultracode })
        return { finalText: 'ok' }
      },
    })

    host = new EnvironmentHost(ud!)
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: runtime.server.url, pairingToken: runtime.auth.createPairingToken().token, label: 'ultracode',
    })
    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir!)
    const { sessionId } = await host.createSession(connectionId, { projectId: project.projectId, harnessId: 'claude' }) as { sessionId: string }

    const turn = { sessionId, projectPath: `remote:${connectionId}:${projectDir}`, providerId: 'claude' }
    await host.sendSessionMessage(connectionId, { ...turn, text: 'refactor it', ultracode: true })
    await host.sendSessionMessage(connectionId, { ...turn, text: 'now stop', ultracode: false })

    expect(seen).toEqual([
      { source: undefined, ultracode: true },
      { source: undefined, ultracode: false },
    ])
  }, 60_000)
})
