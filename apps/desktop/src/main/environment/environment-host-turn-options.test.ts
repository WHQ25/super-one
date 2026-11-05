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
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
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

  it('delivers a controller wake only to the model, while keeping identical human text visible', async () => {
    const [ud, nodeHome, projectDir] = ['eh-wake-ud-', 'eh-wake-node-', 'eh-wake-proj-'].map((prefix) => mkdtempSync(join(tmpdir(), prefix)))
    dirs.push(ud!, nodeHome!, projectDir!)
    electron.userData = ud!
    const seen: Array<Pick<Parameters<TurnRunner>[0], 'source' | 'text'>> = []
    const runner: TurnRunner = async ({ source, text }) => { seen.push({ source, text }); return { finalText: 'ok' } }
    runtime = await startNodeRuntime({
      nodeHome: nodeHome!, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true,
      turnRunner: runner,
    })
    host = new EnvironmentHost(ud!)
    const { connectionId, descriptor } = await host.pairRemote({
      baseUrl: runtime.server.url, pairingToken: runtime.auth.createPairingToken().token, label: 'wake',
    })
    const project = await host.getGateway(descriptor.environmentId)!.openProject(projectDir!)
    const { sessionId } = await host.createSession(connectionId, { projectId: project.projectId, harnessId: 'claude' }) as { sessionId: string }
    const turn = { sessionId, projectPath: `remote:${connectionId}:${projectDir}`, providerId: 'claude', echoUserMessage: true }
    const text = 'A collaboration mailbox message is ready. Call session_collab_retrieve.'
    await host.sendSessionMessage(connectionId, { ...turn, text, clientMessageId: 'collab-message:remote-1', source: 'task-notification' })
    await host.sendSessionMessage(connectionId, { ...turn, text, clientMessageId: 'collab-message:remote-1', source: 'task-notification' })
    await host.sendSessionMessage(connectionId, { ...turn, text, clientMessageId: 'human-1' })
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen).toEqual([{ text, source: 'task-notification' }, { text, source: undefined }])
    const users = () => runtime!.sessions.listMessages({ sessionId }).messages.filter(message => message.role === 'user')
    expect(users().map(message => message.id)).toEqual(['human-1'])
    const mapper = createNodeSessionEventMapper({ sessionId, projectPath: turn.projectPath, skipUserMessage: true })
    const live = runtime.events.listAfter('0').flatMap(event => mapper.map(event)).filter(event => event.type === 'user_message_appended')
    expect(live.map(event => event.message.id)).toEqual(['human-1'])
    // The wake must stay absent from durable history after the node restarts.
    await runtime.stop()
    runtime = await startNodeRuntime({ nodeHome: nodeHome!, bindHost: '127.0.0.1', bindPort: 0, simulatedHarness: true, turnRunner: runner })
    expect(users().map(message => message.id)).toEqual(['human-1'])
    const controller = runtime.sessions.get(sessionId)!.controllerClientSessionId!
    const lease = runtime.leases.acquire({ resource: { environmentId: runtime.identity.environmentId, sessionId }, holderClientId: controller, ttlMs: 30_000 })
    await runtime.sessions.send({ sessionId, text, source: 'task-notification', clientMessageId: 'collab-message:remote-1',
      client: { clientSessionId: controller }, leaseId: lease.leaseId, generation: lease.generation })
    expect(seen).toHaveLength(2)
  }, 60_000)
})
