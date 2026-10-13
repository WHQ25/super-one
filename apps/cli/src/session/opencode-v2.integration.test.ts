import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionLoadResult } from '@superone/shared/environment'
import { startNodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'
import { startOpenCodeOAuthProvider } from '@superone/opencode/testing/native-oauth-provider'
import { startOpenCodeModelProvider, nativeModelFixtureConfig } from '@superone/opencode/testing/native-model-provider'
import { OpenCodeV2Client } from '@superone/opencode/opencode-v2-client'

const binary = process.env.SUPERONE_OPENCODE_NATIVE_TEST_BINARY
function isolateNativeEnvironment(root: string) {
  for (const [name, folder] of Object.entries({ XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data',
    XDG_STATE_HOME: 'state', XDG_CACHE_HOME: 'cache' })) vi.stubEnv(name, join(root, folder))
  vi.stubEnv('SUPERONE_OPENCODE_BINARY', '')
}

async function singleNativeClient(root: string) {
  const services = join(root, 'node', 'opencode-services')
  const registrations = readdirSync(services).filter(name => /^[a-f0-9]{64}$/.test(name))
  expect(registrations).toHaveLength(1)
  const { Service } = await import('@opencode/client/service')
  const endpoint = (await Service.discover({ file: join(services, registrations[0]!, 'opencode', 'service.json') }))!
  return new OpenCodeV2Client({ baseUrl: endpoint.url, password: endpoint.auth!.password, directory: root })
}

describe('production OpenCode V2 over node RPC', () => {
  it.skipIf(!binary)('stops an adopted native inbox execution without an ordinary node turn', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-inbox-stop-')))
    isolateNativeEnvironment(root); vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
    const provider = await startOpenCodeModelProvider()
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)))
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: '!printf inbox-stop-ready', ...lease })
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 10_000 })
      const native = await singleNativeClient(root), nativeId = rt.sessions.get(session.sessionId)!.providerResume!.slice(9)
      const inboxId = await native.prompt(nativeId, { text: 'adopt and stop', delivery: 'queue' })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1))
      await client.rpc('session.inbox.update', { sessionId: session.sessionId, inboxId, delivery: 'steer', ...lease })
      await client.rpc('session.interrupt', { sessionId: session.sessionId, ...lease })
      await vi.waitFor(async () => expect((await native.getSession(nativeId)).outcome).toBe('interrupted'))
      expect(rt.sessions.get(session.sessionId)?.status).toBe('interrupted')
      expect(provider.requests).toHaveLength(1)
    } finally { client?.close(); await rt?.stop(); await provider.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
  it.skipIf(!binary)('replaces a crashed owned service, interrupts its prior turn and never resubmits that input', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-crash-')))
    isolateNativeEnvironment(root); vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
    const provider = await startOpenCodeModelProvider()
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)))
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'before service crash', clientMessageId: 'crashed-input', ...lease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1), { timeout: 10_000 })
      const resume = rt.sessions.get(session.sessionId)?.providerResume
      const services = join(root, 'node', 'opencode-services')
      const file = join(services, readdirSync(services).find(name => /^[a-f0-9]{64}$/.test(name))!, 'opencode', 'service.json')
      const owned = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
      expect(Number.isInteger(owned.pid) && owned.pid > 1 && owned.pid !== process.pid).toBe(true)
      process.kill(owned.pid, 'SIGKILL')
      await client.rpc('session.connection.reconnect', { sessionId: session.sessionId })
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('interrupted'), { timeout: 10_000 })
      expect(provider.requests).toHaveLength(1)
      expect(rt.sessions.get(session.sessionId)?.providerResume).toBe(resume)
      expect((JSON.parse(readFileSync(file, 'utf8')) as { pid: number }).pid).not.toBe(owned.pid)
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'after service crash', clientMessageId: 'fresh-input', ...lease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2), { timeout: 10_000 })
      provider.finish('after crash reply')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'))
      expect(rt.sessions.load({ sessionId: session.sessionId }).messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['crashed-input', 'fresh-input'])
    } finally { client?.close(); await rt?.stop(); await provider.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) }
  }, 40_000)
  it.skipIf(!binary)('adopts already accepted native inbox input while idle and projects its ambient reply', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-inbox-')))
    isolateNativeEnvironment(root); vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
    const provider = await startOpenCodeModelProvider()
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)))
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: '!printf inbox-ready', ...lease })
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 10_000 })
      const native = await singleNativeClient(root)
      const nativeSessionId = rt.sessions.get(session.sessionId)!.providerResume!.slice(9)
      const inputId = await native.prompt(nativeSessionId, { text: 'accepted while idle', delivery: 'queue', metadata: { superoneClientMessageId: 'idle-user' } })
      expect(await client.rpc('session.inbox.list', { sessionId: session.sessionId })).toContainEqual(expect.objectContaining({ id: inputId, delivery: 'queue' }))
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1), { timeout: 10_000 })
      await client.rpc('session.inbox.update', { sessionId: session.sessionId, inboxId: inputId, delivery: 'steer', ...lease })
      provider.finish('existing context reply')
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2), { timeout: 10_000 })
      provider.finish('adopted native reply')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'))
      const loaded = rt.sessions.load({ sessionId: session.sessionId })
      expect(loaded.messages.filter(message => message.id === 'idle-user')).toHaveLength(1)
      expect(loaded.messages.at(-1)?.content.filter(block => block.type === 'text').map(block => block.text).join('')).toBe('existing context replyadopted native reply')
      expect(await client.rpc('session.inbox.list', { sessionId: session.sessionId })).toEqual([])
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'active inbox turn', clientMessageId: 'active-user', ...lease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(3))
      const activeInput = await native.prompt(nativeSessionId, { text: 'accepted during execution', delivery: 'queue', metadata: { superoneClientMessageId: 'active-native-user' } })
      await client.rpc('session.inbox.update', { sessionId: session.sessionId, inboxId: activeInput, delivery: 'steer', ...lease })
      provider.finish('current reply')
      await vi.waitFor(() => expect(provider.requests).toHaveLength(4))
      provider.finish('promoted reply')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'))
      const active = rt.sessions.load({ sessionId: session.sessionId })
      expect(active.messages.filter(message => message.id === 'active-native-user')).toHaveLength(1)
      expect(active.messages.find(message => message.id === 'active-native-user')?.checkpointId).toBe(activeInput)
      expect(active.messages.filter(message => message.role === 'assistant').at(-1)?.content.filter(block => block.type === 'text').map(block => block.text).join('')).toBe('current replypromoted reply')
    } finally { client?.close(); await rt?.stop(); await provider.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) }
  }, 35_000)
  it.skipIf(!binary)('uses node provider-store credentials and rotates an idle service while retaining native history', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-provider-')))
    isolateNativeEnvironment(root)
    const provider = await startOpenCodeModelProvider()
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      rt.providers.upsertCustomPlatform({ id: 'custom:fixture', brand: 'Fixture', name: 'Fixture', plans: [{ id: 'api', name: 'API',
        auth: 'api-key', baseUrl: provider.baseUrl, endpoints: [{ id: 'chat', protocols: ['openai-chat'], models: [{ id: 'fixture' }] }] }] })
      const credential = rt.providers.createCredential({ platformId: 'custom:fixture', planId: 'api', name: 'Local fixture', secret: 'fixture-first-key' })
      rt.providers.setBinding({ consumer: 'chat:opencode', credentialId: credential.id })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const catalog = await client.rpc('harness.resources', { projectId: project.projectId, harnessId: 'opencode' }) as { opencode: { models: Array<{ id: string }> } }
      const model = catalog.opencode.models[0]!.id
      expect(model).toMatch(/^superone_node_.*\/fixture$/)
      expect(await client.rpc('provider.listModels', { harness: 'opencode' })).toContainEqual(expect.objectContaining({ id: model }))
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'first provider turn', model, ...lease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1), { timeout: 15_000 })
      expect(provider.requests[0]?.authorization).toBe('Bearer fixture-first-key')
      provider.finish('first provider reply')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'))
      const resume = rt.sessions.get(session.sessionId)?.providerResume
      rt.providers.updateCredential(credential.id, { secret: 'fixture-rotated-key' })
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'after rotation', model, ...lease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2), { timeout: 15_000 })
      expect(provider.requests[1]?.authorization).toBe('Bearer fixture-rotated-key')
      expect(JSON.stringify(provider.requests[1]?.body.messages)).toContain('first provider reply')
      provider.finish('after rotation reply')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'))
      expect(rt.sessions.get(session.sessionId)?.providerResume).toBe(resume)
    } finally { client?.close(); await rt?.stop(); await provider.close(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) }
  }, 45_000)
  it.skipIf(!binary)('streams and steers native model turns through the remote composer queue', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-steer-')))
    isolateNativeEnvironment(root); vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
    const provider = await startOpenCodeModelProvider()
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(provider.baseUrl)))
      writeFileSync(join(root, '.gitignore'), '/node/\n/config/\n/data/\n/state/\n/cache/\n')
      execFileSync('git', ['init', '-q', root])
      execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'])
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'first', clientMessageId: 'first', ...lease })
      await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThan(0), { timeout: 15_000 })
      expect(provider.requests[0]?.authorization).toBe('Bearer fixture-only-key')
      await client.rpc('session.send', { sessionId: session.sessionId, text: 'second', clientMessageId: 'second', priority: 'next', ...lease })
      expect(rt.sessions.load({ sessionId: session.sessionId }).state.queuedMessages).toContainEqual(expect.objectContaining({ id: 'second' }))
      await client.rpc('session.steer', { sessionId: session.sessionId, clientMessageId: 'second', priority: 'now', ...lease })
      expect(rt.sessions.load({ sessionId: session.sessionId }).state.queuedMessages).toEqual([])
      provider.finish('first native answer')
      await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThan(1), { timeout: 10_000 })
      provider.finish('second native answer')
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 10_000 })
      const loaded = rt.sessions.load({ sessionId: session.sessionId })
      expect(loaded.messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['first', 'second'])
      expect(loaded.messages.filter(message => message.role === 'assistant')).toHaveLength(1)
      expect(loaded.messages.find(message => message.role === 'assistant')?.content.filter(block => block.type === 'text').map(block => block.text).join('')).toBe('first native answersecond native answer')
      const checkpoints = loaded.messages.filter(message => message.role === 'user').map(message => message.checkpointId)
      expect(checkpoints).toEqual([expect.stringMatching(/^msg_/), expect.stringMatching(/^msg_/)])
      expect(checkpoints[0]).not.toBe(checkpoints[1])
      const fork = await client.rpc('session.fork', { sessionId: session.sessionId, mode: 'local', forkFromMessageId: 'first', ...lease }) as { ok: boolean; sessionId: string }
      expect(fork.ok).toBe(true)
      const child = rt.sessions.get(fork.sessionId)!
      expect(child.providerResume).not.toBe(rt.sessions.get(session.sessionId)?.providerResume)
      expect(rt.sessions.load({ sessionId: child.sessionId }).messages.map(message => message.id)).toEqual(['first'])
      const childLease = await client.rpc('session.acquireControl', { sessionId: child.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: child.sessionId, text: 'continue fork', clientMessageId: 'child-input', ...childLease })
      await vi.waitFor(() => expect(provider.requests).toHaveLength(3), { timeout: 10_000 })
      const childContext = JSON.stringify(provider.requests[2]?.body.messages)
      expect(childContext).toContain('first')
      expect(childContext).not.toContain('second native answer')
      expect(childContext).not.toContain('first native answer')
      provider.finish('independent fork reply')
      await vi.waitFor(() => expect(rt!.sessions.get(child.sessionId)?.status).toBe('idle'), { timeout: 10_000 })
      expect(rt.sessions.load({ sessionId: child.sessionId }).messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['first', 'child-input'])
      expect(rt.sessions.load({ sessionId: session.sessionId }).messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['first', 'second'])
      const preview = await client.rpc('session.previewRewind', { sessionId: session.sessionId, checkpointId: checkpoints[1] }) as { canRewind: boolean; supportsCodeOnly: boolean }
      expect(preview).toMatchObject({ canRewind: true, supportsCodeOnly: false })
      await client.rpc('session.rewind', { sessionId: session.sessionId, checkpointId: checkpoints[1], mode: 'conversation', ...lease })
      const rewound = rt.sessions.load({ sessionId: session.sessionId })
      expect(rewound.messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['first'])
      expect(rewound.messages.find(message => message.role === 'assistant')?.content.filter(block => block.type === 'text').map(block => block.text).join('')).toBe('first native answer')
      client.close(); await rt.stop()
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      client = await connectAuthedRpc(rt)
      expect(await client.rpc('session.previewRewind', { sessionId: session.sessionId, checkpointId: checkpoints[0] })).toMatchObject({ canRewind: true })
      const restoredLease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.rewind', { sessionId: session.sessionId, checkpointId: checkpoints[0], mode: 'conversation', ...restoredLease })
      expect(rt.sessions.load({ sessionId: session.sessionId }).messages).toEqual([])
      expect(provider.requests).toHaveLength(3)
    } finally {
      client?.close(); await rt?.stop(); await provider.close()
      vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true })
    }
  }, 45_000)
  it.skipIf(!binary)('authenticates node MCP through a leased controller callback and clears its waiting forms', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-oauth-')))
    isolateNativeEnvironment(root)
    const provider = await startOpenCodeOAuthProvider()
    const modelProvider = await startOpenCodeModelProvider('native OAuth ready')
    vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
    let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
    let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
    try {
      writeFileSync(join(root, 'opencode.json'), JSON.stringify({ ...nativeModelFixtureConfig(modelProvider.baseUrl), mcp: { servers: { oauth_fixture: {
        type: 'remote', url: `${provider.baseUrl}/mcp`, codemode: false,
      } } } }))
      rt = await startNodeRuntime({ nodeHome: join(root, 'node'), bindHost: '127.0.0.1', bindPort: 0 })
      rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
      client = await connectAuthedRpc(rt)
      const project = await client.rpc('project.open', { path: root }) as { projectId: string }
      const session = await client.rpc('session.create', { projectId: project.projectId, harnessId: 'opencode' }) as { sessionId: string }
      const lease = await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 }) as { leaseId: string; generation: string }
      await client.rpc('session.send', { sessionId: session.sessionId, text: '!printf native-oauth-ready', ...lease })
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 15_000 })
      await vi.waitFor(async () => expect(await client!.rpc('session.mcpStatus', { sessionId: session.sessionId })).toContainEqual(
        expect.objectContaining({ name: 'oauth_fixture', status: 'needs-auth' })), { timeout: 5000 })
      const flow = client.rpc('session.mcpAuthenticate', { sessionId: session.sessionId, serverName: 'oauth_fixture', ...lease })
      void flow.catch(() => {})
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.pendingInteraction?.kind).toBe('question'), { timeout: 5000 })
      const pending = rt.sessions.get(session.sessionId)!.pendingInteraction!
      const question = (pending.input!.questions as Array<{ question: string }>)[0]!.question
      const authorize = /\]\((https?:[^)]+)\)/.exec(question)?.[1]
      expect(authorize).toBeTruthy()
      const response = await fetch(authorize!, { redirect: 'manual' })
      const callback = response.headers.get('location')!
      expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:/)
      await client.rpc('session.respondQuestion', { sessionId: session.sessionId, interactionId: pending.interactionId,
        answers: { 'Sign-in callback URL': callback }, ...lease })
      await flow
      expect(provider.authorized).toBe(true)
      expect(await client.rpc('session.mcpStatus', { sessionId: session.sessionId })).toContainEqual(
        expect.objectContaining({ name: 'oauth_fixture', status: 'connected' }))
      await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.pendingInteraction).toBeNull())
      expect(rt.sessions.load({ sessionId: session.sessionId }).messages).toHaveLength(2)
    } finally {
      client?.close(); await rt?.stop(); await provider.close(); await modelProvider.close()
      vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it.skipIf(!binary)(
    'discovers cold catalogs, fences sends, persists native turns and resumes after node restart',
    async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'superone-node-v2-rpc-')))
      for (const [name, folder] of Object.entries({
        XDG_CONFIG_HOME: 'config',
        XDG_DATA_HOME: 'data',
        XDG_STATE_HOME: 'state',
        XDG_CACHE_HOME: 'cache',
      }))
        vi.stubEnv(name, join(root, folder))
      // The catalog is enabled after startup, so the first turn must resolve it then.
      vi.stubEnv('SUPERONE_OPENCODE_BINARY', '')
      vi.stubEnv('SUPERONE_FIXTURE_KEY', 'fixture-only-key')
      const modelProvider = await startOpenCodeModelProvider('native shell reply')
      let rt: Awaited<ReturnType<typeof startNodeRuntime>> | undefined
      let client: Awaited<ReturnType<typeof connectAuthedRpc>> | undefined
      const nodeHome = join(root, 'node')
      const boot = () => startNodeRuntime({ nodeHome, bindHost: '127.0.0.1', bindPort: 0 })
      try {
        writeFileSync(join(root, 'opencode.json'), JSON.stringify(nativeModelFixtureConfig(modelProvider.baseUrl)))
        rt = await boot()
        rt.harnesses.update('opencode', { enabled: true, state: 'ready', command: binary })
        client = await connectAuthedRpc(rt)
        const project = (await client.rpc('project.open', { path: root })) as { projectId: string }
        const resources = (await client.rpc('harness.resources', {
          projectId: project.projectId,
          harnessId: 'opencode',
        })) as {
          opencode: { agents: Array<{ id: string }>; permissionModes: string[] }
        }
        expect(resources.opencode.agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(['build', 'plan']))
        expect(resources.opencode.permissionModes).toEqual([])
        const session = (await client.rpc('session.create', {
          projectId: project.projectId,
          harnessId: 'opencode',
          options: { agent: 'plan' },
        })) as { sessionId: string; agent: string }
        expect(session.agent).toBe('plan')
        const lease = (await client.rpc('session.acquireControl', { sessionId: session.sessionId, ttlMs: 60_000 })) as {
          leaseId: string
          generation: string
        }
        await expect(
          client.rpc('session.send', {
            sessionId: session.sessionId,
            text: '!printf stale-proof',
            ...lease,
            generation: 'stale',
          }),
        ).rejects.toThrow()
        const send = {
          sessionId: session.sessionId,
          text: '!printf rpc-native-first',
          clientMessageId: 'user-first',
          ...lease,
        }
        const accepted = await client.rpc('session.send', send, 'first-send')
        expect(await client.rpc('session.send', send, 'first-send')).toEqual(accepted)
        await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 15_000 })
        const nativeResume = rt.sessions.get(session.sessionId)?.providerResume
        expect(nativeResume).toMatch(/^opencode:ses_/)
        const first = (await client.rpc('session.load', {
          sessionId: session.sessionId,
          full: true,
        })) as SessionLoadResult
        expect(first.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
        expect(first.messages[1]?.content).toContainEqual(
          expect.objectContaining({ type: 'tool_result', summary: 'rpc-native-first' }),
        )
        expect(first.messages[1]?.resumePointId).toBe(nativeResume)
        expect(await client.rpc('session.inbox.list', { sessionId: session.sessionId })).toEqual([])
        const mcp = await client.rpc('session.mcpStatus', { sessionId: session.sessionId }) as Array<{ name: string; status: string }>
        expect(mcp).toContainEqual(expect.objectContaining({ name: 'superone', status: 'connected' }))
        const refreshed = await client.rpc('session.refreshResources', { sessionId: session.sessionId, ...lease }) as {
          opencode: { agents: Array<{ id: string }> }
        }
        expect(refreshed.opencode.agents.map(agent => agent.id)).toContain('plan')
        expect(rt.sessions.get(session.sessionId)?.providerResume).toBe(nativeResume)

        client.close()
        client = undefined
        await rt.stop()
        rt = await boot()
        expect(rt.sessions.get(session.sessionId)).toMatchObject({ agent: 'plan', providerResume: nativeResume })
        client = await connectAuthedRpc(rt, 'reconnected')
        const secondLease = (await client.rpc('session.acquireControl', {
          sessionId: session.sessionId,
          ttlMs: 60_000,
        })) as typeof lease
        await client.rpc('session.send', {
          sessionId: session.sessionId,
          text: '!printf rpc-native-resumed',
          agent: 'build',
          clientMessageId: 'user-second',
          ...secondLease,
        })
        await vi.waitFor(() => expect(rt!.sessions.get(session.sessionId)?.status).toBe('idle'), { timeout: 15_000 })
        expect(rt.sessions.get(session.sessionId)?.providerResume).toBe(nativeResume)
        expect(rt.sessions.get(session.sessionId)?.agent).toBe('build')
        const loaded = (await client.rpc('session.load', {
          sessionId: session.sessionId,
          full: true,
        })) as SessionLoadResult
        expect(loaded.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
        expect(loaded.messages[3]?.content).toContainEqual(
          expect.objectContaining({ type: 'tool_result', summary: 'rpc-native-resumed' }),
        )
        expect(loaded.state.runtimeCapabilities).toMatchObject({
          supportsQueuedSteer: true,
          supportsStreamingToolInput: true,
        })
        expect(loaded.state.openCodeAgentId).toBe('build')
      } finally {
        client?.close()
        await rt?.stop()
        await modelProvider.close()
        vi.unstubAllEnvs()
        rmSync(root, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
