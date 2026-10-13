import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RecentFolder, TerminalSnapshot } from '@superone/shared/agent-types'
import type { ControlLease, EnvironmentEventEnvelope, ExecutionEnvironmentDescriptor, ProjectSnapshot } from '@superone/shared/environment'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import Database from 'better-sqlite3'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'
import { bindControlActor } from '@superone/runtime/lease'
import { createDraftStore, DraftControl } from '@superone/runtime/drafts'
import { createAutomationStore, ensureAutomationsTable } from '@superone/runtime/automations'
import { createSessionProviderStore } from '@superone/runtime/session'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))
/** B's own SQLite, holding its credential store. */
const desktopDb = vi.hoisted(() => ({ current: null as unknown as ReturnType<typeof openNodeDatabase> }))

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
vi.mock('../database', () => ({
  getDb: () => desktopDb.current,
  maskApiKey: (key: string) => (key.length <= 6 ? '***' : '***' + key.slice(-6)),
}))

import { NodeConnectionManager } from '../environment/node-connection-manager'
import { RemoteHostActionConsumer } from '../environment/remote-host-action-consumer'
import { NodeCredentialStore } from '../environment/node-credential-store'
import { createDesktopProjectsPort } from './desktop-projects-port'
import { createDesktopProvidersPort } from './desktop-providers-port'
import * as credentialStore from '../providers/credential-store'
import { RemoteEnvironmentGateway } from '../environment/remote-environment-gateway'
import { AGENT_PROFILES, FakeSessionManager, memorySessionEdits, memoryStore, startDesktopNode, stopDesktopNode, testHarnessHooks, type FakeSession } from './node-host-test-fixtures'
import type { DesktopDomainDeps } from './desktop-domain'
import { desktopAgentSettings } from './desktop-agent-settings'
import { REDACTED_PROFILE_SECRET } from './desktop-session-providers'
import { DesktopNodeHost } from './node-host-server'
import type { DesktopDomainDeps } from './desktop-domain'
import { createDesktopTerminalsPort } from './desktop-terminals-port'
import { TerminalManager } from '../terminal/terminal-manager'
import { runWindowControl } from '../session/control-context'
import { mapNodeSessionEvents } from '@superone/shared/node-session-event-map'

const dirs: string[] = []
const hosts: DesktopNodeHost[] = []
const managers: NodeConnectionManager[] = []

beforeEach(() => {
  desktopDb.current = openNodeDatabase(':memory:')
  desktopDb.current.exec(`
    CREATE TABLE credentials (
      id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, plan_id TEXT NOT NULL, name TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '', secret_env TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '',
      overrides_json TEXT NOT NULL DEFAULT '{}', endpoints_json TEXT, notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE custom_platforms (id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE consumer_bindings (consumer TEXT PRIMARY KEY, credential_id TEXT NOT NULL, endpoint_id TEXT, config_json TEXT NOT NULL DEFAULT '{}');
  `)
})

afterEach(async () => {
  for (const m of managers.splice(0)) m.disconnectAll()
  for (const h of hosts.splice(0)) await stopDesktopNode(h)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

/** B's window catalogs: what its composer offers, without probing a real harness. */
function fakeCatalog() {
  return {
    connectClaude: vi.fn(async () => ({
      models: [{ id: 'claude-opus', name: 'Opus', description: '' }],
      account: { email: 'b@example.com' },
      slashCommands: [{ name: 'review', description: 'Review', argumentHint: '', isSkill: false }],
      skills: [], commands: [], agents: [], outputStyles: ['default'],
    })),
    listModels: vi.fn(async (harnessId: string) => harnessId === 'codex' ? [{ id: 'gpt-5', name: 'GPT-5', description: '' }] : []),
  }
}

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

/** B's terminal tabs over scripted PTYs; `writes` collects what reaches them. */
function scriptedTerminals() {
  const writes: string[] = []
  const listeners = new Set<(event: import('@superone/shared/agent-types').TerminalEvent) => void>()
  const manager = new TerminalManager({
    spawner: { spawn: () => ({ write: (data) => writes.push(data), resize: () => {}, kill: () => {}, onExit: () => {}, onData: () => {}, foregroundProcess: () => 'zsh' }) },
    onEvent: (event) => { for (const listener of listeners) listener(event) },
    exists: () => true,
    coalesceMs: 0,
  })
  const deps: Partial<DesktopDomainDeps> = {
    terminals: createDesktopTerminalsPort(manager, (listener) => { listeners.add(listener); return () => listeners.delete(listener) }),
    bindLocalControl: (authority) => manager.bindLeases(authority),
  }
  return { manager, writes, deps }
}

/** B with one git project (origin + a commit), paired with a fresh A. */
async function pairedDesktops(catalog = fakeCatalog(), extra: Partial<DesktopDomainDeps> = {}) {
  const userData = tempDir('superone-node-host-')
  const projectDir = tempDir('superone-node-host-project-')
  execFileSync('git', ['init', '-q', projectDir])
  execFileSync('git', ['-C', projectDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
  const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
  harnesses.enableSimulatedOverlay()
  const providerChanges = { providerConfigChanged: vi.fn(), providerBindingChanged: vi.fn() }
  const host = await startDesktopNode(
    {
      userDataDir: userData, label: 'Desktop B', appVersion: '0.0.0-test', sessions, rows: store.all, sessionEdits: memorySessionEdits(store, sessions), projects, harnesses, catalog,
      providers: createDesktopProvidersPort(credentialStore, providerChanges),
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: testHarnessHooks(),
      ...extra,
    },
    { bindPort: 23000 + Math.floor(Math.random() * 10000) },
  )
  hosts.push(host)
  const pairing = host.mintPairingToken()
  const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
  managers.push(manager)
  const { connectionId } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
  return { host, sessions, store, projectDir, manager, connectionId, client: manager.getClient(connectionId)!, providerChanges }
}

describe('DesktopNodeHost', () => {
  it('serves projects and controller-owned sessions with a durable event log across restarts', async () => {
    const userData = tempDir('superone-node-host-')
    const projectDir = tempDir('superone-node-host-project-')
    execFileSync('git', ['init', '-q', projectDir])
    execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
    const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
    const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
    const sessions = new FakeSessionManager()
    const store = memoryStore(() => projects.list())
    const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
    harnesses.enableSimulatedOverlay()
    const terminals = scriptedTerminals()
    const port = 23000 + Math.floor(Math.random() * 10000)
    const start = (bindPort: number) => startDesktopNode(
      {
        ...terminals.deps,
        userDataDir: userData,
        label: 'Desktop B',
        appVersion: '0.0.0-test',
        sessions,
        rows: store.all,
        sessionEdits: {
          ...memorySessionEdits(store, sessions),
          fork: async ({ sessionId }, assertControl) => {
            assertControl()
            store.createRow({ sessionId: `${sessionId}-fork`, projectPath: projectDir, cwd: projectDir })
            return { ok: true, sessionId: `${sessionId}-fork` }
          },
        },
        projects,
        harnesses,
        catalog: fakeCatalog(),
        listAgentProfiles: () => AGENT_PROFILES,
        hooks: testHarnessHooks(),
      },
      { bindPort },
    )

    let host = await start(port)
    hosts.push(host)
    expect(host.url).toContain('127.0.0.1')

    const pairing = host.mintPairingToken()
    // Pairing outside the encrypted channel is refused.
    const plain = await fetch(`${pairing.url}/v1/pair`, { method: 'POST', body: JSON.stringify({ pairingToken: pairing.pairingToken }), headers: { 'content-type': 'application/json', connection: 'close' } })
    expect(plain.status).toBe(403)
    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
    managers.push(manager)
    const { connectionId, descriptor } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
    expect(descriptor.environmentId).toBe(host.identity.environmentId)
    const client = manager.getClient(connectionId)!

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities.methods).toContain('session.get')
    // The workspace, Git, catalog and terminals its window and phones get.
    for (const method of ['workspace.readFile', 'git.status', 'git.branches', 'harness.resources', 'provider.listModels', 'terminal.create']) expect(described.capabilities.methods).toContain(method)
    expect(described.capabilities.methods).not.toContain('collaboration.send')
    expect(described.capabilities.harnessIds).toContain('claude')

    const listed = await client.rpc<ProjectSnapshot[]>('project.list')
    expect(listed).toEqual([expect.objectContaining({ projectId: 'p1', repoIdentity: 'git:https://example.com/acme/app.git' })])

    const created = await client.rpc<{ sessionId: string; controllerClientSessionId: string }>('session.create', {
      projectId: 'p1', harnessId: 'claude', title: 'child', systemPromptAppend: 'report back', permissionMode: 'acceptEdits',
    })
    const live = sessions.live.get(created.sessionId)!
    // Owned by the controller: this desktop's own UI cannot send into it, and its own active session is kept.
    expect(live.lease.current).toMatchObject({ holderClientId: created.controllerClientSessionId })
    expect(sessions.active).toBe('local-session')
    expect(store.rows.get(created.sessionId)?.controller).toMatchObject({ label: 'Desktop A', systemPromptAppend: 'report back', permissionMode: 'acceptEdits' })

    // Without the lease the controller cannot drive the session.
    await expect(client.rpc('session.send', { sessionId: created.sessionId, text: 'hi', leaseId: 'x', generation: '1' })).rejects.toThrow()
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'do the task', clientMessageId: 'm1', leaseId: lease.leaseId, generation: lease.generation })
    expect(live.sent[0]).toMatchObject({ content: 'do the task', clientMessageId: 'm1' })

    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    const types = events.map((e) => e.eventType)
    expect(types).toEqual(['session.created', 'session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(events[1].payload).toMatchObject({ blockId: 'm1', text: 'do the task' })
    expect((events[2].payload as { event: Record<string, unknown> }).event).not.toHaveProperty('projectPath')

    // The session edits, terminals and harness installs B's window has.
    const forked = await client.rpc<{ ok: boolean; session: { sessionId: string } }>('session.fork', { sessionId: created.sessionId, mode: 'local', leaseId: lease.leaseId, generation: lease.generation })
    expect(forked).toMatchObject({ ok: true, session: { sessionId: `${created.sessionId}-fork` } })
    expect(await client.rpc('terminal.create', { cwd: projectDir })).toMatchObject({ terminalId: expect.any(String), cwd: projectDir })
    expect(await client.rpc('harness.enable', { harnessId: 'codex' })).toMatchObject({ id: 'codex' })

    // Restart B (on a fresh port: fetch would reuse the closed keep-alive socket): the cursor continues from the durable log.
    manager.disconnectAll()
    await stopDesktopNode(host)
    hosts.splice(0)
    host = await start(port + 1)
    hosts.push(host)
    const reconnected = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a2-')) })
    managers.push(reconnected)
    const again = host.mintPairingToken()
    const second = await reconnected.pairAndConnect({ baseUrl: again.url, pairingToken: again.pairingToken, label: 'Desktop A', channel: again.channel })
    const after = await reconnected.getClient(second.connectionId)!.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: events[1].sequence })
    expect(after.events.map((e) => e.sequence)).toEqual(events.slice(2).map((e) => e.sequence))
    const snapshot = await reconnected.getClient(second.connectionId)!.rpc<{ snapshotSequence: string }>('session.snapshot')
    expect(snapshot.snapshotSequence).toBe(events.at(-1)!.sequence)
  })
})

describe('DesktopNodeHost composer', () => {
  it('offers a controller the models, catalog and Git its window has', async () => {
    const catalog = fakeCatalog()
    const { client } = await pairedDesktops(catalog)
    credentialStore.createCredential({ id: 'cred-b', platformId: 'anthropic', planId: 'api', name: 'Team key', secret: 'sk-team-secret-1234' })
    credentialStore.setBinding({ consumer: 'chat:claude', credentialId: 'cred-b' })

    expect(await client.rpc('provider.listModels', { harness: 'codex', apiProviderId: 'cred-b' })).toEqual([{ id: 'gpt-5', name: 'GPT-5', description: '' }])
    expect(catalog.listModels).toHaveBeenCalledWith('codex', 'cred-b')

    const resources = await client.rpc<{ claude: { models: unknown[]; account: unknown; slashCommands: unknown[]; outputStyles: string[] } }>('harness.resources', { projectId: 'p1', harnessId: 'claude' })
    expect(resources.claude).toMatchObject({
      models: [{ id: 'claude-opus' }], account: { email: 'b@example.com' }, slashCommands: [{ name: 'review' }], outputStyles: ['default'],
    })
    // One probe answers every Claude section.
    expect(catalog.connectClaude).toHaveBeenCalledTimes(1)
    await expect(client.rpc('harness.resources', { projectId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })

    expect(await client.rpc('git.status', { projectId: 'p1' })).toMatchObject({ isRepo: true, dirty: false })
    expect(await client.rpc('git.branches', { projectId: 'p1' })).toMatchObject({ current: expect.any(String) })
    expect(await client.rpc('git.diff', { projectId: 'p1' })).toEqual({ diff: '' })
    expect(await client.rpc('git.worktrees', { projectId: 'p1' })).toEqual([expect.objectContaining({ bare: false })])
    expect(await client.rpc('git.worktreeCheckedOutBranches', { projectId: 'p1' })).toEqual({ branches: [expect.any(String)] })

    // The API provider picker reads masked credentials; key material stays on B.
    expect(await client.rpc('provider.listCredentials')).toEqual([expect.objectContaining({ id: 'cred-b', name: 'Team key', secret: '***t-1234' })])
    expect(await client.rpc('provider.listBindings')).toEqual([{ consumer: 'chat:claude', credentialId: 'cred-b', config: {} }])
  })
})

describe('DesktopNodeHost providers', () => {
  it('lets a controller edit credentials, bindings and custom platforms as B\'s window does', async () => {
    const { client, providerChanges } = await pairedDesktops()
    const secret = 'sk-controller-key-abcdef'

    const created = await client.rpc<Credential>('provider.createCredential', { platformId: 'anthropic', planId: 'api', name: 'Team', secret })
    expect(created.secret).toBe('***abcdef')
    expect(credentialStore.getCredentialDecrypted(created.id)?.secret).toBe(secret)

    // The masked secret the controller read back means "unchanged".
    await expect(client.rpc('provider.updateCredential', { id: created.id, name: 'Team 2', secret: created.secret })).resolves.toMatchObject({ name: 'Team 2' })
    expect(credentialStore.getCredentialDecrypted(created.id)).toMatchObject({ name: 'Team 2', secret })
    expect(providerChanges.providerConfigChanged).toHaveBeenCalledTimes(1)
    await expect(client.rpc('provider.updateCredential', { id: 'missing', name: 'x' })).rejects.toMatchObject({ code: 'not_found' })

    await client.rpc('provider.setBinding', { consumer: 'chat:codex', credentialId: created.id })
    expect(providerChanges.providerBindingChanged).toHaveBeenLastCalledWith('chat:codex')
    expect(await client.rpc('provider.listBindings')).toEqual([{ consumer: 'chat:codex', credentialId: created.id, config: {} }])
    await client.rpc('provider.clearBinding', { consumer: 'chat:codex' })
    expect(providerChanges.providerBindingChanged).toHaveBeenCalledTimes(2)
    expect(await client.rpc('provider.listBindings')).toEqual([])

    const platform = { id: 'custom:acme', brand: 'acme', name: 'Acme', plans: [] } satisfies Platform
    expect(await client.rpc('provider.upsertCustomPlatform', platform)).toEqual(platform)
    expect(await client.rpc('provider.listCustomPlatforms')).toEqual([platform])
    const onPlatform = await client.rpc<Credential>('provider.createCredential', { platformId: platform.id, planId: 'default', name: 'Acme key', secret: 'sk-acme-key-123456' })
    // Removing a platform takes its keys with it.
    await client.rpc('provider.deleteCustomPlatform', { id: platform.id })
    expect(credentialStore.getCredentialDecrypted(onPlatform.id)).toBeUndefined()
    expect(await client.rpc('provider.listCustomPlatforms')).toEqual([])

    await client.rpc('provider.deleteCredential', { id: created.id })
    expect(await client.rpc('provider.listCredentials')).toEqual([])
    await expect(client.rpc('provider.deleteCredential', { id: created.id })).rejects.toMatchObject({ code: 'not_found' })
    expect(providerChanges.providerConfigChanged).toHaveBeenCalledTimes(4)
  })

  it('takes a pushed bundle but never hands key material back', async () => {
    const { client, providerChanges } = await pairedDesktops()
    const pushed = ['sk-pushed-from-a-998877', 'sk-second-key-445566']
    credentialStore.createCredential({ id: 'cred-a', platformId: 'openai', planId: 'api', name: 'Old', secret: 'sk-old-value-000000' })

    const imported = await client.rpc('provider.importBundle', {
      bundle: {
        credentials: [
          { id: 'cred-a', platformId: 'openai', planId: 'api', name: 'A key', secret: pushed[0], notes: '', sortOrder: 0 },
          { id: 'cred-new', platformId: 'anthropic', planId: 'api', name: 'New', secret: pushed[1], notes: '', sortOrder: 1 },
          { id: 'broken' },
        ],
        bindings: [{ consumer: 'chat:claude', credentialId: 'cred-new' }],
        customPlatforms: [],
      },
    })
    expect(imported).toEqual({ credentials: 2, bindings: 1 })
    expect(credentialStore.getCredentialDecrypted('cred-a')).toMatchObject({ name: 'A key', secret: pushed[0] })
    expect(credentialStore.getCredentialDecrypted('cred-new')?.secret).toBe(pushed[1])
    expect(providerChanges.providerConfigChanged).toHaveBeenCalledTimes(1)

    // A sends '' for a key its keychain could not decrypt: B keeps its own, even when replacing all.
    await client.rpc('provider.importBundle', {
      bundle: { credentials: [{ id: 'cred-a', platformId: 'openai', planId: 'api', name: 'Renamed', secret: '' }], bindings: [], customPlatforms: [] },
      replaceAll: true,
    })
    expect(credentialStore.getCredentialDecrypted('cred-a')).toMatchObject({ name: 'Renamed', secret: pushed[0] })
    expect(credentialStore.getCredentialDecrypted('cred-new')).toBeUndefined()

    const reads = JSON.stringify([
      await client.rpc('provider.listCredentials'), await client.rpc('provider.listBindings'), await client.rpc('provider.listCustomPlatforms'),
    ])
    for (const plaintext of pushed) expect(reads).not.toContain(plaintext)
    for (const method of ['provider.getCredentialDecrypted', 'provider.exportBundle']) {
      await expect(client.rpc(method, { id: 'cred-a' })).rejects.toMatchObject({ code: 'not_found' })
    }

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities.methods).toEqual(expect.arrayContaining(['provider.createCredential', 'provider.setBinding', 'provider.importBundle']))
    for (const method of ['provider.getCredentialDecrypted', 'provider.exportBundle']) expect(described.capabilities.methods).not.toContain(method)

    // A's pull stops at its own side, before asking B for keys B withholds.
    const gateway = new RemoteEnvironmentGateway(client)
    await gateway.getDescriptor()
    await expect(gateway.providerExportBundle()).rejects.toMatchObject({ code: 'failed_precondition' })
  })
})

/** B's app settings as its window saved them. */
const B_APP_SETTINGS = {
  agentPreference: {
    claude: { defaultModel: 'claude-opus', defaultEffort: 'high', defaultPermissionMode: 'acceptEdits', defaultSandboxMode: 'auto', disabledSkills: ['lint'], askUserQuestionPreviewFormat: 'markdown' },
    codex: { defaultModel: 'gpt-5', defaultReasoningEffort: 'medium', defaultPermissionPreset: '' },
  },
  experimentalClaudeOpenAiChatEnabled: true,
  defaultClonePaths: { local: '~/Code' },
} as unknown as Parameters<typeof desktopAgentSettings>[0]

describe('DesktopNodeHost configuration', () => {
  it("lets a controller edit B's session providers and automations, read its agent settings and manage its harnesses", async () => {
    const db = new Database(':memory:')
    ensureAutomationsTable(db)
    const runNow = vi.fn(async () => ({ status: 'completed', sessionId: 's-auto' }))
    const enableHarness = vi.fn<DesktopDomainDeps['hooks']['enableHarness']>(async (harnesses, input) => harnesses.get(input.harnessId))
    const { client } = await pairedDesktops(fakeCatalog(), {
      hooks: { ...testHarnessHooks(), enableHarness },
      agentSettings: () => desktopAgentSettings(B_APP_SETTINGS),
      config: {
        sessionProviders: createSessionProviderStore(db),
        automations: { automations: createAutomationStore(db, () => null), automationService: { runNow } },
      },
    })
    try {
      const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
      for (const method of ['sessionProviders.create', 'automation.runNow', 'settings.get', 'sandbox.probe', 'harness.enable', 'harness.disable']) {
        expect(described.capabilities.methods).toContain(method)
      }
      expect(described.capabilities.methods).not.toContain('settings.patch')

      // Session provider profiles: the store B's window edits.
      const { provider } = await client.rpc<{ provider: { id: string } }>('sessionProviders.create', { harnessId: 'claude', name: 'Team', config: { model: 'claude-opus', apiKey: 'sk-b' } })
      await client.rpc('sessionProviders.update', { id: provider.id, name: 'Team Opus' })
      expect(await client.rpc('sessionProviders.get', { id: provider.id })).toMatchObject({ provider: { name: 'Team Opus', config: { model: 'claude-opus', apiKey: REDACTED_PROFILE_SECRET } } })
      const listed = await client.rpc<{ providers: Array<{ id: string }> }>('sessionProviders.list', { harnessId: 'claude' })
      expect(listed.providers.map((p) => p.id)).toEqual(['claude-base', provider.id])
      await expect(client.rpc('sessionProviders.delete', { id: 'claude-base' })).rejects.toMatchObject({ code: 'failed_precondition' })
      expect(await client.rpc('sessionProviders.delete', { id: provider.id })).toEqual({ ok: true })

      // B's own agent defaults, not a node config file.
      expect(await client.rpc('settings.get')).toEqual({
        settings: {
          claude: { defaultModel: 'claude-opus', defaultEffort: 'high', permissionMode: 'acceptEdits', sandboxMode: 'auto', disabledSkills: ['lint'], askUserQuestionPreviewFormat: 'markdown' },
          codex: { defaultModel: 'gpt-5', defaultEffort: 'medium', permissionPreset: '' },
          experimentalClaudeOpenAiChatEnabled: true,
          projectsDir: '~/Code',
        },
      })

      const { automation } = await client.rpc<{ automation: { id: string; projectId: string } }>('automation.create', {
        projectId: 'p1', name: 'Nightly', prompt: 'Run the tests', agentConfig: { type: 'claude', model: 'claude-opus' }, schedule: { type: 'recurring', cron: '0 3 * * *' },
      })
      expect(automation.projectId).toBe('p1')
      expect(await client.rpc('automation.list', { projectId: 'p1' })).toMatchObject({ automations: [{ id: automation.id, name: 'Nightly' }] })
      expect(await client.rpc('automation.runNow', { automationId: automation.id })).toEqual({ automationId: automation.id, status: 'completed', sessionId: 's-auto' })
      expect(runNow).toHaveBeenCalledWith(automation.id)

      expect(await client.rpc('harness.enable', { harnessId: 'claude' })).toMatchObject({ id: 'claude' })
      expect(enableHarness.mock.calls[0][1]).toMatchObject({ harnessId: 'claude' })
      expect(await client.rpc('harness.disable', { harnessId: 'claude' })).toMatchObject({ id: 'claude' })
      expect(await client.rpc('sandbox.probe')).toMatchObject({ ok: expect.any(Boolean), platform: process.platform })
    } finally {
      db.close()
    }
  })
})

describe('DesktopNodeHost resources', () => {
  it("manages B's MCP servers, skills and agents for a controller, with secrets kept on B", async () => {
    const home = tempDir('superone-node-host-home-')
    const mcpChanged = vi.fn()
    const { client, projectDir } = await pairedDesktops(fakeCatalog(), { resources: { homeDir: home, mcpChanged } })
    mkdirSync(join(projectDir, '.claude', 'skills', 'ship'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'skills', 'ship', 'SKILL.md'), '---\ndescription: Ship it\n---\n')
    mkdirSync(join(projectDir, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'agents', 'reviewer.md'), '---\ndescription: Reviews\n---\n')
    const server = { projectId: 'p1', provider: 'claude', name: 'tools', scope: 'project' }
    const listed = async () => (await client.rpc<{ servers: Array<Record<string, unknown>> }>('mcp.list', { projectId: 'p1', provider: 'claude' })).servers

    await client.rpc('mcp.save', { ...server, config: { type: 'stdio', command: 'node', args: ['a.js'], env: { TOKEN: 'secret-token-123' } } })
    expect(await listed()).toEqual([expect.objectContaining({ name: 'tools', command: 'node', env: { TOKEN: '********' } })])

    // An edit sends the masked env back; B keeps the secret.
    await client.rpc('mcp.save', { ...server, config: { type: 'stdio', command: 'node', args: ['b.js'], env: { TOKEN: '********' } } })
    const onDisk = JSON.parse(readFileSync(join(projectDir, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(onDisk.mcpServers.tools).toMatchObject({ args: ['b.js'], env: { TOKEN: 'secret-token-123' } })

    await client.rpc('mcp.toggle', { ...server, disabled: true })
    expect(await listed()).toEqual([expect.objectContaining({ name: 'tools', disabled: true })])
    // B's window applies the same follow-ups as after its own edits.
    expect(mcpChanged).toHaveBeenLastCalledWith({ provider: 'claude', projectPath: projectDir, name: 'tools', enabled: false, saved: false })

    const { skills } = await client.rpc<{ skills: Array<{ name: string; scope: string }> }>('skills.list', { projectId: 'p1', provider: 'claude' })
    expect(skills).toContainEqual(expect.objectContaining({ name: 'ship', scope: 'project' }))
    const { agents } = await client.rpc<{ agents: Array<{ name: string; scope: string }> }>('agents.list', { projectId: 'p1' })
    expect(agents).toContainEqual(expect.objectContaining({ name: 'reviewer', scope: 'project' }))
  })
})

describe('DesktopNodeHost collaboration children', () => {
  it('cuts a worktree for a remote child and carries its mailbox tools to the controller as Host Actions', async () => {
    const { host, sessions, store, projectDir, connectionId, client } = await pairedDesktops()

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities).toMatchObject({ hostActionV1: true })
    expect(described.capabilities.methods).toEqual(expect.arrayContaining(['git.fetch', 'git.worktreeActivate']))
    expect(await client.rpc('git.status', { projectId: 'p1' })).toMatchObject({ isRepo: true, branch: 'main' })
    // Pushed work B's checkout has not seen yet: the fetch makes it the base.
    const origin = tempDir('superone-origin-')
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['-C', projectDir, 'remote', 'set-url', 'origin', origin])
    execFileSync('git', ['-C', projectDir, 'push', '-q', origin, 'HEAD:refs/heads/main'])
    execFileSync('git', ['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
    const pusher = join(tempDir('superone-pusher-'), 'clone')
    execFileSync('git', ['clone', '-q', origin, pusher])
    execFileSync('git', ['-C', pusher, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'pushed from A'])
    execFileSync('git', ['-C', pusher, 'push', '-q', 'origin', 'HEAD:main'])
    await client.rpc('git.fetch', { projectId: 'p1', remote: 'origin' })
    const worktree = await client.rpc<{ path: string }>('git.worktreeActivate', {
      projectId: 'p1', baseBranch: 'origin/HEAD', mode: 'branch', branchName: 'superone/builder-1',
    })
    expect(execFileSync('git', ['-C', worktree.path, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('pushed from A')
    expect(execFileSync('git', ['-C', worktree.path, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('superone/builder-1')
    // A cwd outside the project and its served worktrees stays refused.
    await expect(client.rpc('session.create', { projectId: 'p1', harnessId: 'claude', cwd: tempDir('elsewhere-') }))
      .rejects.toMatchObject({ code: 'invalid_argument' })

    const created = await client.rpc<{ sessionId: string; externalParent?: { sessionId: string } }>('session.create', {
      projectId: 'p1', harnessId: 'claude', title: 'Builder - Implementer', cwd: worktree.path,
      systemPromptAppend: 'child of parent-a', externalParent: { sessionId: 'parent-a' },
    })
    expect(created.externalParent).toEqual({ sessionId: 'parent-a' })
    expect(store.rows.get(created.sessionId)?.controller.externalParent).toEqual({ sessionId: 'parent-a' })
    expect(host.sessions.externalParentOf(created.sessionId)).toEqual({ sessionId: 'parent-a' })
    expect(sessions.live.get(created.sessionId)!.cwd).toBe(worktree.path)
    void projectDir

    // A's persistent consumer runs whatever the child asks of the controller.
    const executed: Array<{ toolName: string; sessionId: string; args: unknown }> = []
    const consumer = new RemoteHostActionConsumer({
      connectionId,
      client,
      pollWaitMs: 200,
      executor: async (claimed) => {
        executed.push({ toolName: claimed.toolName, sessionId: claimed.sessionId, args: claimed.args })
        return { outcome: 'succeeded', result: { content: [{ type: 'text', text: '{"status":"sent"}' }] } }
      },
    })
    consumer.start()
    try {
      const live = sessions.live.get(created.sessionId)!
      live.status = 'streaming'
      const terminal = await host.sessions.requestHostAction({
        sessionId: created.sessionId, toolName: 'session_collab_send', args: { content: 'Pushed the branch' },
      })
      expect(terminal).toMatchObject({ state: 'succeeded', result: { content: [{ type: 'text', text: '{"status":"sent"}' }] } })
      expect(executed).toEqual([{ toolName: 'session_collab_send', sessionId: created.sessionId, args: { content: 'Pushed the branch' } }])

      // An action outlives no turn: the end of the run cancels what is still pending.
      consumer.stop('test')
      await consumer.waitUntilStopped()
      const pending = host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_retrieve', args: {} })
      live.status = 'idle'
      const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
      await client.rpc('session.send', { sessionId: created.sessionId, text: 'wake', leaseId: lease.leaseId, generation: lease.generation })
      await expect(pending).resolves.toMatchObject({ state: 'cancelled' })
    } finally {
      consumer.stop('test')
      await consumer.waitUntilStopped()
    }
  })
})

describe('DesktopNodeHost agent catalog', () => {
  it('lists the agents it can launch and creates a child on the model and key picked from them', async () => {
    const { sessions, store, client } = await pairedDesktops()
    expect(await client.rpc('collaboration.listProfiles')).toEqual(AGENT_PROFILES)
    // The mailbox stays with the controller: only the catalog of the family is served.
    await expect(client.rpc('collaboration.send', { sessionId: 's', content: 'x' })).rejects.toMatchObject({ code: 'not_found' })

    const created = await client.rpc<{ sessionId: string; model: string | null; apiProviderId: string | null }>('session.create', {
      projectId: 'p1', harnessId: 'claude', options: { model: 'claude-opus', effort: 'medium', apiProviderId: 'cred-b' },
    })
    const live = sessions.live.get(created.sessionId)!
    expect(live.apiProviderId).toBe('cred-b')
    expect(store.rows.get(created.sessionId)?.controller).toMatchObject({ model: 'claude-opus', effort: 'medium', apiProviderId: 'cred-b' })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).toMatchObject({ model: 'claude-opus', apiProviderId: 'cred-b' })

    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'go', leaseId: lease.leaseId, generation: lease.generation })
    expect(live.sent[0]).toMatchObject({ content: 'go', model: 'claude-opus', effort: 'medium' })
  })
})

describe('DesktopNodeHost visibility', () => {
  it("shows a controller every session of the desktop and lets it edit them as B's window does", async () => {
    const { sessions, store, client, projectDir } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    // A session this desktop's user runs.
    store.createRow({ sessionId: 'own-session', projectPath: projectDir, cwd: projectDir, title: 'Mine' })
    const own = sessions.createSession({ id: 'own-session', projectPath: projectDir }) as unknown as FakeSession
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    sessions.live.get(created.sessionId)!.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    expect(new Set(events.map((e) => e.aggregateId))).toEqual(new Set([created.sessionId, 'own-session']))
    const listed = await client.rpc<Array<{ sessionId: string }>>('session.list', { projectId: 'p1', limit: 50, offset: 0 })
    expect(listed.map((s) => s.sessionId).sort()).toEqual([created.sessionId, 'own-session'].sort())
    expect(await client.rpc('session.get', { sessionId: 'own-session' })).toMatchObject({ title: 'Mine', controllerClientSessionId: null })

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    for (const method of ['session.setCwd', 'session.setTags', 'session.setUiFlags', 'session.close', 'session.remove', 'session.modUi', 'session.rewind', 'session.hostActionsPoll']) {
      expect(described.capabilities.methods).toContain(method)
    }
    await client.rpc('session.setTags', { sessionId: 'own-session', set: ['review'] })
    await client.rpc('session.setUiFlags', { sessionId: 'own-session', isPinned: true })
    expect(store.rows.get('own-session')).toMatchObject({ tags: ['review'], isPinned: true })

    // Driving B's own session takes its lease and leaves its launch origin alone.
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: 'own-session' })
    await client.rpc('session.send', { sessionId: 'own-session', text: 'from A', leaseId: lease.leaseId, generation: lease.generation })
    expect(own.sent[0]).toMatchObject({ content: 'from A' })
    expect(store.rows.get('own-session')?.controller).toBeNull()
    await client.rpc('session.close', { sessionId: 'own-session', leaseId: lease.leaseId, generation: lease.generation })
    expect(sessions.live.has('own-session')).toBe(false)
  })
})

describe('DesktopNodeHost lifecycle and prompts', () => {
  it('answers in-flight Host Actions when the host stops', async () => {
    const { host, sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    sessions.live.get(created.sessionId)!.status = 'streaming'
    const pending = host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_retrieve', args: {} })

    // Turning remote access off (or changing its port) stops the listener; no controller can answer.
    await host.stop()
    await expect(pending).resolves.toMatchObject({ state: 'cancelled' })

    // Quitting closes the domain, which takes no more.
    hosts.splice(hosts.indexOf(host), 1)
    host.domain.close()
    await expect(host.sessions.requestHostAction({ sessionId: created.sessionId, toolName: 'session_collab_send', args: {} }))
      .rejects.toMatchObject({ code: 'failed_precondition' })
  })

  it('reports the live prompt of a session as its pending interaction', async () => {
    const { sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const live = sessions.live.get(created.sessionId)!
    live.status = 'streaming'
    const read = async () => (await client.rpc<{ pendingInteraction: Record<string, unknown> | null }>('session.get', { sessionId: created.sessionId })).pendingInteraction

    expect(await read()).toBeNull()

    live.pending = [{ type: 'permission_request', request: { requestId: 'perm-1', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' }, allowAlwaysAllow: true } } as AgentEvent]
    const permission = await read()
    expect(permission).toMatchObject({ interactionId: 'perm-1', kind: 'permission', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' }, allowAlwaysAllow: true })
    // Stable across reads, so a controller can tell a prompt it already shows.
    expect((await read())?.createdAt).toBe(permission?.createdAt)

    live.pending = [{ type: 'ask_user_question', request: { requestId: 'q-1', questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }], multiSelect: false }] } } as AgentEvent]
    expect(await read()).toMatchObject({ interactionId: 'q-1', kind: 'question', input: { questions: [{ question: 'Which?' }] } })

    live.pending = [{ type: 'plan_approval', request: { requestId: 'plan-1', planContent: 'Do it', planFilePath: '/tmp/plan.md', allowedPrompts: [] } } as AgentEvent]
    expect(await read()).toMatchObject({ interactionId: 'plan-1', kind: 'plan', input: { plan: 'Do it' } })

    // A reconnecting controller restores the prompt from the snapshot.
    const snapshot = await client.rpc<{ sessions: Array<{ sessionId: string; pendingInteraction: unknown }> }>('session.snapshot')
    expect(snapshot.sessions.find((s) => s.sessionId === created.sessionId)?.pendingInteraction).toMatchObject({ interactionId: 'plan-1', kind: 'plan' })
  })
})

describe('DesktopNodeHost takeback', () => {
  it('lets this desktop take a session back and the controller reconnect only on purpose', async () => {
    const { host, sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string; controllerClientSessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const live = sessions.live.get(created.sessionId)!
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    const { snapshotSequence } = await client.rpc<{ snapshotSequence: string }>('session.snapshot')

    // Disconnect here: this desktop drives it, the controller's lease is gone.
    host.sessions.releaseControl(created.sessionId)
    expect(live.lease.current).toBeNull()
    await expect(client.rpc('session.send', { sessionId: created.sessionId, text: 'hi', leaseId: lease.leaseId, generation: lease.generation }))
      .rejects.toMatchObject({ code: 'failed_precondition', details: { reason: 'control_released' } })
    await expect(client.rpc('session.renewControl', { leaseId: lease.leaseId, generation: lease.generation })).rejects.toMatchObject({ code: 'lease_stale' })
    // An ordinary acquire (the controller's automatic one before a send) does not take it back.
    await expect(client.rpc('session.acquireControl', { sessionId: created.sessionId }))
      .rejects.toMatchObject({ details: { reason: 'control_released' } })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).toMatchObject({ controlReleased: true })

    // The controller learns it from the event log, as this desktop's UI does from the session.
    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: snapshotSequence })
    expect(events.map((e) => (e.payload as { event?: AgentEvent }).event)).toContainEqual({ type: 'remote_control_changed', released: true })

    // Reconnect: an explicit reclaim drives it again, and again, like a phone.
    const reclaimed = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId, reclaim: true })
    expect(Number(reclaimed.generation)).toBeGreaterThan(Number(lease.generation))
    expect(live.lease.current).toMatchObject({ holderClientId: created.controllerClientSessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'go on', leaseId: reclaimed.leaseId, generation: reclaimed.generation })
    expect(live.sent.at(-1)).toMatchObject({ content: 'go on' })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).not.toHaveProperty('controlReleased')

    host.sessions.releaseControl(created.sessionId)
    await client.rpc('session.acquireControl', { sessionId: created.sessionId, reclaim: true })
    expect(live.lease.current?.holderClientId).toBe(created.controllerClientSessionId)
  })
})

describe('DesktopNodeHost launch tasks', () => {
  it("shows a controller agent's launch task as a task from that desktop, here and on the controller", async () => {
    const { sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    const { snapshotSequence } = await client.rpc<{ snapshotSequence: string }>('session.snapshot')
    await client.rpc('session.send', {
      sessionId: created.sessionId, text: 'Fix the flaky upload test', clientMessageId: 'task-1', leaseId: lease.leaseId, generation: lease.generation,
      options: { echoUserMessage: true, collaboration: { kind: 'initial_task' } },
    })
    expect(sessions.live.get(created.sessionId)!.sent[0]).toMatchObject({
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Desktop A' },
    })

    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: snapshotSequence })
    const mapped = mapNodeSessionEvents(events, { sessionId: created.sessionId, projectPath: 'remote:b:/p', providerId: 'claude' })
    const task = mapped.find((e) => e.type === 'user_message_appended')
    expect(task && 'message' in task ? task.message.metadata : null).toEqual({
      source: 'collaboration',
      collaboration: { kind: 'initial_task', direction: 'inbound', fromSessionTitle: 'Desktop A' },
    })
  })
})

describe('DesktopNodeHost control takeover', () => {
  /** B's window driving one of B's sessions, as its composer does. */
  const windowControl = (session: FakeSession) => runWindowControl(1, () => session.lease.assertMutation())

  it("takes over what B's window holds, but never a lease of B's phones", async () => {
    const { host, sessions, projectDir, client } = await pairedDesktops()
    const own = sessions.createSession({ id: 'own-session', projectPath: projectDir }) as unknown as FakeSession
    windowControl(own)
    expect(own.lease.current?.delegate).toBe('window:1')

    const lease = await client.rpc<ControlLease>('session.acquireControl', { sessionId: own.id, yields: true })
    const controller = host.controllers()[0].id
    expect(lease).toMatchObject({ holderClientId: controller })
    expect(own.lease.current).toMatchObject({ leaseId: lease.leaseId, holderClientId: controller })
    expect(own.lease.isExternal).toBe(true)
    // The controller's own yield reaches only the phones it relays, not B's window.
    expect(() => windowControl(own)).toThrow()
    const relayed = await client.rpc<ControlLease>('session.acquireControl', { sessionId: own.id, delegate: 'phone:a-device' })
    expect(relayed).toMatchObject({ holderClientId: controller, delegate: 'phone:a-device' })
    expect(own.lease.phoneDeviceId).toBeNull()
    // A controller's grant never reads as B's window.
    await expect(client.rpc('session.acquireControl', { sessionId: own.id, delegate: 'window:1' })).rejects.toMatchObject({ code: 'invalid_argument' })

    // B's phone holds another session: the controller does not take it.
    const phoneHeld = sessions.createSession({ id: 'phone-session', projectPath: projectDir }) as unknown as FakeSession
    bindControlActor(host.domain.leases, { clientSessionId: 'phone:p', holderClientId: `desktop:${host.identity.environmentId}`, delegate: 'phone:p', yields: 'none' })
      .acquire({ resource: phoneHeld.lease.resource, holderClientId: 'phone:p', ttlMs: 60_000 })
    await expect(client.rpc('session.acquireControl', { sessionId: phoneHeld.id, yields: true })).rejects.toMatchObject({ code: 'failed_precondition' })
    expect(phoneHeld.lease.phoneDeviceId).toBe('p')
  })

  it("leaves B's window its lease when B took the session back and the controller does not reclaim", async () => {
    const { host, sessions, client } = await pairedDesktops()
    const created = await client.rpc<{ sessionId: string }>('session.create', { projectId: 'p1', harnessId: 'claude' })
    const live = sessions.live.get(created.sessionId)!
    host.sessions.releaseControl(created.sessionId)
    windowControl(live)
    const held = live.lease.current!
    expect(held.delegate).toBe('window:1')

    await expect(client.rpc('session.acquireControl', { sessionId: created.sessionId, yields: true }))
      .rejects.toMatchObject({ details: { reason: 'control_released' } })
    expect(live.lease.current).toEqual(held)
    windowControl(live)

    // An explicit reconnect takes it over.
    const reclaimed = await client.rpc<ControlLease>('session.acquireControl', { sessionId: created.sessionId, reclaim: true })
    expect(live.lease.current).toMatchObject({ leaseId: reclaimed.leaseId, generation: reclaimed.generation })
    expect(await client.rpc('session.get', { sessionId: created.sessionId })).not.toHaveProperty('controlReleased')
  })

  it("serves B's terminals to a controller under its own writer identity", async () => {
    const terminals = scriptedTerminals()
    const { host, projectDir, client } = await pairedDesktops(fakeCatalog(), terminals.deps)
    const controller = host.controllers()[0].id

    const created = await client.rpc<{ terminalId: string }>('terminal.create', { cwd: projectDir })
    const tab = terminals.manager.get(created.terminalId)!
    expect(await client.rpc('terminal.list')).toMatchObject({ terminals: [{ terminalId: created.terminalId }] })
    // B's window types in it first.
    tab.lease.assertWindow(1)
    const before = await client.rpc<{ terminal: TerminalSnapshot }>('terminal.attach', { terminalId: created.terminalId })
    expect(before.terminal).toMatchObject({ ownerDeviceId: null, writableByMe: false })

    const lease = await client.rpc<ControlLease>('terminal.acquireControl', { terminalId: created.terminalId, ttlMs: 60_000 })
    await client.rpc('terminal.write', { terminalId: created.terminalId, data: 'ls\r', leaseId: lease.leaseId, generation: lease.generation })
    expect(terminals.writes).toEqual(['ls\r'])
    const after = await client.rpc<{ terminal: TerminalSnapshot }>('terminal.attach', { terminalId: created.terminalId })
    expect(after.terminal).toMatchObject({ ownerDeviceId: `node:${controller}`, writableByMe: true })
    expect(tab.lease.isWritableBy('local')).toBe(false)
    expect(() => tab.lease.assertWindow(1)).toThrow()
  })

  it("ends a controller's draft grants when it disconnects and when B stops listening", async () => {
    const db = new Database(':memory:')
    const drafts = new DraftControl(createDraftStore(db))
    const { host, projectDir, manager, connectionId, client } = await pairedDesktops(fakeCatalog(), { drafts })
    const controller = host.controllers()[0].id
    drafts.upsert({ id: 'd1', text: 'from B', projectPath: projectDir })

    await client.rpc('draft.open', { draftId: 'd1' })
    expect(drafts.get('d1')?.controllerDeviceId).toBe(controller)
    manager.disconnect(connectionId)
    await vi.waitFor(() => expect(drafts.get('d1')?.controllerDeviceId).toBeNull())

    await manager.connectExisting(connectionId)
    await manager.getClient(connectionId)!.rpc('draft.open', { draftId: 'd1' })
    expect(drafts.get('d1')?.controllerDeviceId).toBe(controller)
    hosts.splice(hosts.indexOf(host), 1)
    await stopDesktopNode(host)
    expect(drafts.get('d1')?.controllerDeviceId).toBeNull()
    // B's window edits it again.
    expect(drafts.upsert({ id: 'd1', text: 'B again' }).text).toBe('B again')
    db.close()
  })

  it.each([
    ['removed', (host: DesktopNodeHost, id: string) => host.removeController(id)],
    ['turned off', (host: DesktopNodeHost, id: string) => host.setControllerEnabled(id, false)],
  ])("ends a controller's session and terminal leases when it is %s", async (_case, cut) => {
    const terminals = scriptedTerminals()
    const { host, sessions, projectDir, client } = await pairedDesktops(fakeCatalog(), terminals.deps)
    const controller = host.controllers()[0].id
    const own = sessions.createSession({ id: 'own-session', projectPath: projectDir }) as unknown as FakeSession
    await client.rpc('session.acquireControl', { sessionId: own.id, yields: true })
    const { terminalId } = await client.rpc<{ terminalId: string }>('terminal.create', { cwd: projectDir })
    await client.rpc('terminal.acquireControl', { terminalId })
    const tab = terminals.manager.get(terminalId)!
    expect(tab.lease.ownerDeviceId).toBe(`node:${controller}`)

    cut(host, controller)
    expect(own.lease.current).toBeNull()
    expect(tab.lease.ownerDeviceId).toBeNull()
    // B's window drives both again.
    windowControl(own)
    tab.lease.assertWindow(1)
  })
})
