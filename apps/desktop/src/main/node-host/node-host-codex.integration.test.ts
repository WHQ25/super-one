import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
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
import { AGENT_PROFILES, FakeSessionManager, memorySessionEdits, memoryStore, startDesktopNode, stopDesktopNode, testHarnessHooks } from './node-host-test-fixtures'
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
      userDataDir: tempDir('superone-node-codex-'), label: 'Desktop B', appVersion: '0.0.0-test', sessions, rows: store.all, sessionEdits: memorySessionEdits(store, sessions), projects, harnesses,
      codex: codex.services,
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: testHarnessHooks(),
    },
    { bindPort: 23000 + Math.floor(Math.random() * 10000) },
  )
  hosts.push(host)
  const pairing = host.mintPairingToken()
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
  managers.push(manager)
  const { connectionId } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
  return { host, codex, projectDir, client: manager.getClient(connectionId)! }
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

  it.each([
    ['removed', (host: DesktopNodeHost, id: string) => host.removeController(id)],
    ['turned off', (host: DesktopNodeHost, id: string) => host.setControllerEnabled(id, false)],
  ])("cancels a controller's waiting device-code sign-in when it is %s", async (_case, cut) => {
    const { host, codex, client } = await pairedWithCodex()
    let n = 0
    codex.service.accounts.start.mockImplementation(async (type: string, accountId?: string) => ({
      type, loginId: `login-${++n}`, verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-EFGH', accountId: accountId ?? 'acct-1',
    }))

    await client.rpc('codex.accountLoginStart', { projectId: 'p1' })
    // A controller keeps one sign-in waiting: starting another ends the first.
    await client.rpc('codex.accountLoginStart', { projectId: 'p1', accountId: 'acct-2' })
    expect(codex.service.cancelAccountLogin.mock.calls).toEqual([['login-1']])

    cut(host, host.controllers()[0].id)
    // The code it was shown can no longer sign B's account in.
    await vi.waitFor(() => expect(codex.service.cancelAccountLogin.mock.calls).toEqual([['login-1'], ['login-2']]))
  })

  it("hands a controller the MCP authorization URL and forwards the browser's callback to Codex on B", async () => {
    const { codex, projectDir, client } = await pairedWithCodex()
    // Codex's loopback listener on B; its completion notification follows the callback.
    let completed!: () => void
    const received: string[] = []
    const listener = createServer((req, res) => { received.push(req.url!); res.end('done'); completed() })
    await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r))
    const port = (listener.address() as { port: number }).port
    const authorizationUrl = `https://mcp.example/authorize?state=s1&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}`
    codex.service.loginMcpServerOauth.mockImplementation((async (_path: string, _name: string, _provider: string | null, openUrl?: (url: string) => void) => {
      openUrl?.(authorizationUrl)
      await new Promise<void>((r) => { completed = r })
      return { success: true }
    }) as typeof codex.service.loginMcpServerOauth)

    try {
      const started = await client.rpc<{ loginId: string; authorizationUrl: string }>('codex.loginMcpOauth', { projectId: 'p1', serverName: 'linear' })
      expect(started).toEqual({ loginId: expect.any(String), authorizationUrl })
      expect(codex.service.loginMcpServerOauth).toHaveBeenCalledWith(projectDir, 'linear', null, expect.any(Function), {})

      const callback = `http://127.0.0.1:${port}/callback?code=c1&state=s1`
      for (const wrong of [callback.replace(String(port), String(port + 1)), callback.replace('state=s1', 'state=other')]) {
        await expect(client.rpc('codex.completeMcpOauth', { loginId: started.loginId, callbackUrl: wrong })).rejects.toMatchObject({ code: 'invalid_argument' })
      }
      expect(await client.rpc('codex.completeMcpOauth', { loginId: started.loginId, callbackUrl: callback })).toEqual({ success: true })
      expect(received).toEqual(['/callback?code=c1&state=s1'])
      await expect(client.rpc('codex.completeMcpOauth', { loginId: started.loginId })).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      listener.close()
    }

    // A sign-in that fails before Codex has a URL answers its outcome at once.
    codex.service.loginMcpServerOauth.mockResolvedValueOnce({ success: false, error: 'Codex returned no authorization URL' } as never)
    expect(await client.rpc('codex.loginMcpOauth', { projectId: 'p1', serverName: 'linear' })).toEqual({ success: false, error: 'Codex returned no authorization URL' })
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
