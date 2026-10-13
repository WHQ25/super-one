import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `b-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (v === undefined) throw new Error('missing')
      return v
    },
  },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { NodeConnectionManager } from '../environment/node-connection-manager'
import { NodeCredentialStore } from '../environment/node-credential-store'
import { createDesktopProjectsPort } from './desktop-projects-port'
import { fakeCodexServices } from './codex-test-fixtures'
import { AGENT_PROFILES, FakeSessionManager, memoryStore, startDesktopNode, stopDesktopNode } from './node-host-test-fixtures'
import type { DesktopNodeHost } from './node-host-server'

const dirs: string[] = []
const hosts: DesktopNodeHost[] = []
const managers: NodeConnectionManager[] = []

afterEach(async () => {
  for (const m of managers.splice(0)) m.disconnectAll()
  for (const h of hosts.splice(0)) await stopDesktopNode(h)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

/** B with one project and its window's Codex services, paired with a fresh A. */
async function pairedWithCodex() {
  const projectDir = tempDir('superone-node-codex-project-')
  execFileSync('git', ['init', '-q', projectDir])
  const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
  harnesses.enableSimulatedOverlay()
  const codex = fakeCodexServices()
  const host = await startDesktopNode(
    {
      userDataDir: tempDir('superone-node-codex-'), label: 'Desktop B', appVersion: '0.0.0-test', sessions, store, rows: store.all, projects, harnesses,
      codex: codex.services,
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: { probeHarnessReadiness: () => ({ ok: true }) as never, assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }) },
    },
    { bindPort: 23000 + Math.floor(Math.random() * 10000) },
  )
  hosts.push(host)
  const pairing = host.mintPairingToken()
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
  managers.push(manager)
  const { connectionId } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
  return { codex, projectDir, client: manager.getClient(connectionId)! }
}

describe('DesktopNodeHost codex', () => {
  it("serves a controller B's Codex account, limits and auth by project id", async () => {
    const { codex, projectDir, client } = await pairedWithCodex()

    expect(await client.rpc('codex.getAccountStatus', { projectId: 'p1', apiProviderId: 'codex-account:a1' })).toMatchObject({ signedIn: true, email: 'b@example.com' })
    expect(codex.service.getAccountStatus).toHaveBeenCalledWith('codex-account:a1')
    expect(await client.rpc('codex.listAccounts', { projectId: 'p1' })).toEqual([expect.objectContaining({ id: 'cli', isDefault: true })])

    expect(await client.rpc('codex.getRateLimits', { projectId: 'p1', apiProviderId: null })).toMatchObject({ primary: { usedPercent: 40 } })
    expect(codex.service.getRateLimits).toHaveBeenCalledWith(projectDir, null)
    expect(await client.rpc('codex.consumeRateLimitReset', { projectId: 'p1', apiProviderId: null, creditId: null })).toBe('reset')
    await expect(client.rpc('codex.getRateLimits', { projectId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })

    // A key is written on B and answered with its status only.
    const auth = await client.rpc<Record<string, unknown>>('codex.setAuth', { projectId: 'p1', mode: 'apiKey', apiKey: 'sk-secret' })
    expect(codex.service.setAuth).toHaveBeenCalledWith(projectDir, { mode: 'apiKey', apiKey: 'sk-secret' })
    expect(auth).toMatchObject({ mode: 'apiKey', hasSessionApiKey: true })
    expect(JSON.stringify(auth)).not.toContain('sk-secret')

    // Without a runtime, the app-server methods fail closed.
    codex.service.isRuntimeReady.mockReturnValue(false)
    await expect(client.rpc('codex.getRateLimits', { projectId: 'p1' })).rejects.toMatchObject({ code: 'failed_precondition' })
  })

  it('signs a controller in with a device code instead of a browser callback on B', async () => {
    const { codex, client } = await pairedWithCodex()

    expect(await client.rpc('codex.accountLoginStart', { projectId: 'p1' })).toMatchObject({
      type: 'chatgptDeviceCode', loginId: 'login-1', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH',
    })
    expect(codex.service.accounts.start).toHaveBeenCalledWith('chatgptDeviceCode', undefined)
    expect(await client.rpc('codex.accountLoginCancel', { loginId: 'login-1' })).toEqual({ ok: true })
    expect(codex.service.cancelAccountLogin).toHaveBeenCalledWith('login-1')
  })

  it("lists and installs B's Codex plugins", async () => {
    const { codex, projectDir, client } = await pairedWithCodex()

    expect(await client.rpc('codex.plugins.list', { projectId: 'p1' })).toEqual({ plugins: [expect.objectContaining({ key: 'demo@mp' })], provider: 'codex' })
    const marketplace = await client.rpc<{ plugins: unknown[] }>('codex.plugins.list', { projectId: 'p1', marketplace: true })
    expect(marketplace.plugins).toHaveLength(2)
    expect(await client.rpc('codex.plugins.install', { projectId: 'p1', key: 'other@mp' })).toEqual({ ok: true, key: 'other@mp' })
    expect(codex.plugins.installPlugin).toHaveBeenCalledWith(projectDir, 'other@mp')
    expect(await client.rpc('codex.marketplace.remove', { projectId: 'p1', marketplaceName: 'mp' })).toEqual({ ok: true })
    expect(codex.marketplace.remove).toHaveBeenCalledWith(projectDir, 'mp')
  })
})
