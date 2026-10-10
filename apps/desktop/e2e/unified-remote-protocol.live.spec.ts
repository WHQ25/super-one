/** Opt-in acceptance against real desktops and the alpha relay, without model calls. */
import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { RelayClient } from '@superone/relay-client'
import { startPairingHandshake, type PairResult } from '../../../packages/relay-client/src/pair'
import { decodeNodePairingCode, encodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import { CURRENT_ONBOARDING_EPOCH } from '@superone/shared/onboarding'
import { launchDesktop, removeInstanceData, type DesktopInstance } from './fixtures/desktop-instance'

const RELAY = 'wss://relay-alpha.super-one.dev'
const A = 'protocol-live-a'
const B = 'protocol-live-b'
test.skip(process.env.SUPERONE_E2E_LIVE_RELAY !== '1', 'Requires explicit live relay acceptance')
test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
let project: string
let a: DesktopInstance
let b: DesktopInstance
let remoteEnvironmentId: string
let remoteConnectionId: string
let lanPort: number
const pairings: PairResult[] = []
const phones: RelayClient[] = []

function scripted(steps: unknown[]): string {
  return `<scripted>${JSON.stringify(steps).replace(/</g, '\\u003c')}</scripted>`
}

async function inWindow<T>(page: Page, expression: string): Promise<T> {
  return page.evaluate(expression) as Promise<T>
}

async function pairPhone(index: number): Promise<PairResult> {
  await inWindow(a.window, 'window.__phonePairReceived = false; window.app.onPairingCodeReceived(() => { window.__phonePairReceived = true })')
  const qr = await inWindow<{ channelId: string; tempKeyHex: string; relayUrl: string }>(a.window, 'window.app.startPairing()')
  const pair = startPairingHandshake({
    qr: { ...qr, desktopDeviceId: A }, mobileDeviceId: `protocol-live-phone-${index}`,
    deviceName: `Protocol phone ${index}`, openSocket: url => new WebSocket(url),
  })
  await expect.poll(() => inWindow(a.window, 'window.__phonePairReceived'), { timeout: 30_000 }).toBe(true)
  await a.window.evaluate(code => window.app.confirmPairing(code), pair.code)
  return pair.done
}

async function connect(index: number, route: 'lan' | 'relay', lost: string[] = [], events: unknown[] = []): Promise<RelayClient> {
  const client = new RelayClient({ onEvents: batch => events.push(...batch), onControlLost: resource => lost.push('sessionId' in resource ? resource.sessionId : resource.terminalId) })
  phones.push(client)
  const link = pairings[index]
  if (route === 'lan') await client.connectLan('127.0.0.1', lanPort, link)
  else await client.connectRelay({ relayUrl: link.relayUrl, link, deviceId: `protocol-live-phone-${index}` })
  await client.verifyHost()
  return client
}

test.beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'protocol-live-')))
  project = join(root, 'project')
  await mkdir(project)
  await writeFile(join(project, 'readme.md'), '# Protocol acceptance\n')
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.invalid', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=Acceptance', '-c', 'user.email=acceptance@example.invalid', 'commit', '-qm', 'fixture'], { cwd: project })
  async function launch(name: string, port: number) {
    return launchDesktop(name, { env: { SUPERONE_E2E_SCRIPTED_HARNESS: '1', SUPERONE_HOME: join(root, name) }, seed: {
      'app-settings.json': { locale: 'en', experimentalRemoteNodesEnabled: true, remoteNodeAccessPort: port, analyticsEnabled: false, onboardingCompletedAt: Date.now(), onboardingEpoch: CURRENT_ONBOARDING_EPOCH },
      'remote-config.json': { enabled: true, masterSecret: randomBytes(32).toString('hex'), deviceId: name, relayUrl: RELAY },
    } })
  }
  a = await launch(A, 7897)
  b = await launch(B, 7898)
  await a.window.evaluate(path => window.app.addRecentFolder(path), project)
  await b.window.evaluate(path => window.app.addRecentFolder(path), project)
  await expect.poll(() => inWindow(a.window, 'window.app.getRelayStatus()'), { timeout: 30_000 }).toBe(true)
  for (let index = 0; index < 2; index++) pairings.push(await pairPhone(index))
  const log = await readFile(join(process.cwd(), `instance-${A}-dev.log`), 'utf8')
  const port = [...log.matchAll(/\[LanServer\] Listening on [^\n]+:(\d+)/g)].at(-1)?.[1]
  if (!port) throw new Error('Actual phone LAN endpoint did not start')
  lanPort = Number(port)
  const code = await inWindow<string>(b.window, 'window.app.devMintNodePairingCode()')
  const decoded = decodeNodePairingCode(code)
  remoteEnvironmentId = decoded.environmentId
  delete decoded.lan
  delete decoded.tailscaleHost
  expect(decoded.relay).toBeDefined()
  const pairingPhone = await connect(0, 'lan')
  try {
    expect(await pairingPhone.rpc('client.pairNode', { nodeCode: encodeNodePairingCode(decoded), nodeName: 'Protocol desktop B' })).toEqual({ ok: true })
    const minted = await pairingPhone.rpc<{ nodeCode: string }>('client.mintNodeCode', { controllerName: 'Protocol acceptance' })
    expect(decodeNodePairingCode(minted.nodeCode).environmentId).toBe(pairingPhone.environmentId)
    const items = await inWindow<Array<{ environmentId: string; connectionId: string; activePath?: string; endpointProfiles: Array<{ kind: string }> }>>(a.window, 'window.environment.listItems()')
    const remote = items.find(item => item.environmentId === remoteEnvironmentId)
    expect(remote?.endpointProfiles.map(profile => profile.kind)).toEqual(['relay'])
    expect(remote?.activePath).toBe('relay')
    remoteConnectionId = remote!.connectionId
  } finally {
    pairingPhone.disconnect()
  }
})

test.afterEach(async () => {
  try {
    for (const instance of [a, b]) {
      const log = await readFile(join(process.cwd(), `instance-${instance.name}-dev.log`), 'utf8')
      expect(log).not.toMatch(/\[harness\] (?:fetching|enable (?:claude|codex))/)
    }
  } finally {
    for (const phone of phones.splice(0)) phone.disconnect()
  }
})
test.afterAll(async () => {
  await a?.app.close().catch(() => {})
  await b?.app.close().catch(() => {})
  if (root) await rm(root, { recursive: true, force: true })
  await removeInstanceData(A)
  await removeInstanceData(B)
})

for (const route of ['lan', 'relay'] as const) {
  test(`native phone families and window contention over ${route}`, async () => {
    const lost: string[] = []
    const events: unknown[] = []
    const one = await connect(0, route, lost, events)
    const two = await connect(1, route)
    const target = await one.resolveProject(project)
    const descriptor = await one.rpc<{ environmentId: string; capabilities: { methods: string[] } }>('environment.descriptor')
    expect(descriptor.environmentId).toBe(one.environmentId)
    expect(descriptor.capabilities.methods).toContain('session.send')
    expect(await one.rpc('git.status', { projectId: target.projectId })).toMatchObject({ branch: 'main', dirty: false })
    expect(await one.rpc('workspace.listDir', { projectId: target.projectId, relativePath: '.' })).toContainEqual(expect.objectContaining({ name: 'readme.md' }))
    expect(await one.rpc('files.read', { path: join(project, 'readme.md'), preferInline: true })).toMatchObject({ ok: true, text: '# Protocol acceptance\n' })
    for (const [method, payload] of [
      ['harness.options', {}], ['harness.systemInfo', { projectId: target.projectId, harnessId: 'claude' }],
      ['harness.projectResources', { projectId: target.projectId, harnessId: 'claude' }],
      ['mcp.list', { projectId: target.projectId }], ['mcp.icons', { projectId: target.projectId }],
      ['workspace.searchMentions', { projectId: target.projectId, query: 'readme' }],
      ['workspace.mentionIcons', { ids: [] }], ['media.listProviders', {}],
      ['git.branches', { projectId: target.projectId }], ['git.worktrees', { projectId: target.projectId }],
      ['git.defaultClonePath', {}], ['environment.list', {}],
    ] as const) await test.step(method, async () => { expect(await one.rpc(method, payload)).toBeDefined() })
    const draftId = `live-draft-${route}`
    await one.rpc('draft.upsert', { id: draftId, text: 'saved', projectPath: project, attachments: [] })
    const opened = await one.rpc<{ leaseId: string }>('draft.open', { draftId })
    expect(opened).toMatchObject({ draft: { id: draftId, text: 'saved' } })
    await one.rpc('draft.close', { draftId, leaseId: opened.leaseId })
    await one.rpc('draft.delete', { draftId })

    const sessionId = await a.window.evaluate(path => window.agent.createSession(path), project)
    await a.window.evaluate(([path, id]) => window.agent.sendMessage(path, { sessionId: id, content: '<scripted>[{"say":"INITIAL-WINDOW-TURN"}]</scripted>' }), [project, sessionId])
    await expect.poll(async () => one.rpc('session.load', { sessionId }).then(() => true, () => false)).toBe(true)
    console.log('[live] created window session; acquiring phone control')
    const session = { environmentId: one.environmentId!, sessionId }
    const grant = await one.acquireControl(session)
    await expect(two.acquireControl(session)).rejects.toMatchObject({ code: 'failed_precondition' })
    console.log('[live] loading persisted window session')
    const loaded = await one.rpc<{ cursor: { sequence: string; epoch: string; version: number } }>('session.load', { sessionId })
    for (const [method, payload] of [
      ['sessionList.page', { projectId: target.projectId }], ['sessionList.pinned', {}],
      ['sessionList.find', { sessionId }], ['sessionList.search', { query: 'INITIAL' }],
      ['session.historyIndex', { sessionId }], ['session.activity', {}],
      ['session.linkMetadata', { refs: [session] }], ['session.linkResolve', { ref: session }],
      ['mcp.searchMentions', { sessionId, query: 'readme' }], ['mcp.readMentions', { sessionId, targets: [] }],
      ['client.markSeen', { sessionId }], ['client.appendLog', { entries: [{ message: 'live protocol acceptance' }] }],
    ] as const) await test.step(method, async () => { expect(await one.rpc(method, payload)).toBeDefined() })
    await one.controlledRpc(session, 'session.setUiFlags', { isPinned: true })
    await one.controlledRpc(session, 'session.patchSettings', { settings: { model: 'scripted' } })
    await one.followSession({ session, projectPath: project, cursor: loaded.cursor })
    console.log('[live] sending phone turn')
    await one.controlledRpc(session, 'session.send', { text: scripted([
      { tool: 'widget_show', args: { html: '<p>Protocol acceptance widget</p>' } },
      { say: 'LIVE-PHONE-TURN' },
    ]) })
    await expect.poll(() => JSON.stringify(events), { timeout: 30_000 }).toContain('LIVE-PHONE-TURN')

    await test.step('composer form belongs to the authenticated phone', async () => {
      const history = await one.rpc<{ messages: Array<{ id: string; content: Array<{ type: string; toolName?: string }> }> }>('session.load', { sessionId })
      const widget = history.messages.find(message => message.content.some(block => block.type === 'tool_use' && block.toolName?.endsWith('widget_show')))
      expect(widget).toBeDefined()
      const input = { viewId: 'live-view', localId: 'live-form', messageId: widget!.id, output: 'caller',
        spec: { title: 'Protocol form', requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } } }
      const form = await one.controlledRpc<{ ok: boolean; requestId: string }>(session, 'composer.open', input)
      expect(form.ok).toBe(true)
      await two.rpc('composer.cancel', { viewId: input.viewId, localId: input.localId })
      expect(await one.rpc('composer.outcome', { inputRequestId: form.requestId })).toEqual({ state: 'pending' })
      await one.controlledRpc(session, 'session.respondPermission', { interactionId: form.requestId, decision: 'allow', formAnswers: { color: 'blue' } })
      expect(await one.rpc('composer.outcome', { inputRequestId: form.requestId })).toMatchObject({ state: 'settled', outcome: { status: 'submitted', values: { color: 'blue' } } })
    })
    await test.step('host files, upload and conditional workspace writes', async () => {
      const folder = `phone-${route}`
      expect(await one.rpc('files.mkdir', { path: project, name: folder })).toEqual({ ok: true })
      expect(await one.rpc('files.listDir', { path: project })).toBeDefined()
      const path = join(project, folder, 'upload.txt')
      expect(await one.rpc('files.upload', { uploadId: `inline-${route}`, sessionId, targetDir: join(project, folder), name: 'upload.txt', mimeType: 'text/plain', size: 6, inlineBase64: Buffer.from('upload').toString('base64') })).toMatchObject({ ok: true, status: 'saved', savedPath: path })
      expect(await one.rpc('files.read', { path, preferInline: true })).toMatchObject({ ok: true, text: 'upload' })
      const original = await one.rpc<{ hash: string }>('workspace.readFile', { projectId: target.projectId, relativePath: 'readme.md' })
      await one.rpc('workspace.writeFile', { projectId: target.projectId, relativePath: 'readme.md', content: '# Changed\n', expectedHash: original.hash })
      await expect(one.rpc('workspace.writeFile', { projectId: target.projectId, relativePath: 'readme.md', content: 'stale', expectedHash: original.hash })).rejects.toMatchObject({ code: 'conflict' })
      await one.rpc('workspace.writeFile', { projectId: target.projectId, relativePath: 'readme.md', content: '# Protocol acceptance\n' })
      await rm(join(project, folder), { recursive: true })
    })
    await test.step('project edits and git branch lifecycle', async () => {
      const extra = join(root, `extra-${route}`)
      await mkdir(extra)
      await one.rpc('project.update', { projectId: target.projectId, addExtraDirs: [extra] })
      await one.rpc('project.update', { projectId: target.projectId, removeExtraDirs: [extra] })
      await one.rpc('git.setDefaultClonePath', { path: extra })
      expect(await one.rpc('git.defaultClonePath')).toEqual({ path: extra })
      await one.rpc('git.createBranch', { projectId: target.projectId, branch: `phone-${route}` })
      await one.rpc('git.switchBranch', { projectId: target.projectId, branch: `phone-${route}` })
      expect(await one.rpc('git.status', { projectId: target.projectId })).toMatchObject({ branch: `phone-${route}` })
      await one.rpc('git.switchBranch', { projectId: target.projectId, branch: 'main' })
    })
    await test.step('native session creation, archive and deletion', async () => {
      const created = await one.rpc<{ sessionId: string }>('session.create', { projectId: target.projectId, harnessId: 'claude', title: 'Phone-created acceptance' })
      const ref = { environmentId: one.environmentId!, sessionId: created.sessionId }
      await one.acquireControl(ref)
      await one.controlledRpc(ref, 'session.setUiFlags', { isHidden: true })
      expect(await one.rpc('session.get', { sessionId: ref.sessionId })).toMatchObject({ isHidden: true })
      await one.controlledRpc(ref, 'session.remove')
      await expect(one.rpc('session.load', { sessionId: ref.sessionId })).rejects.toMatchObject({ code: 'not_found' })
    })
    await expect(two.rpc('session.send', { sessionId, leaseId: grant.leaseId, generation: grant.generation, text: 'stolen' })).rejects.toMatchObject({ code: 'lease_stale' })
    await a.window.evaluate(id => window.agent.disconnectRemoteSession(id), sessionId)
    await expect.poll(() => lost.includes(sessionId)).toBe(true)
    await expect(one.controlledRpc(session, 'session.send', { text: 'retired' })).rejects.toMatchObject({ code: 'lease_required' })
    await a.window.evaluate(([path, id]) => window.agent.sendMessage(path, { sessionId: id, content: '<scripted>[{"say":"LIVE-WINDOW-TURN"}]</scripted>' }), [project, sessionId])
    await one.stopSession()

    const terminal = await a.window.evaluate(path => window.terminal.create({ projectPath: path }), project)
    const terminalRef = { environmentId: one.environmentId!, terminalId: terminal.terminalId }
    await one.acquireControl(terminalRef)
    await expect(two.acquireControl(terminalRef)).rejects.toMatchObject({ code: 'failed_precondition' })
    await one.controlledRpc(terminalRef, 'terminal.write', { data: "printf 'LIVE-TERMINAL\\n'\r" })
    await expect.poll(async () => JSON.stringify(await one.rpc('terminal.attach', { terminalId: terminal.terminalId }))).toContain('LIVE-TERMINAL')
    await a.window.evaluate(id => window.terminal.claim(id), terminal.terminalId)
    await expect.poll(() => lost.includes(terminal.terminalId)).toBe(true)
    await expect(one.controlledRpc(terminalRef, 'terminal.write', { data: 'stale\r' })).rejects.toMatchObject({ code: 'lease_required' })
    await a.window.evaluate(id => window.terminal.kill(id), terminal.terminalId)
    const remote = await one.rpc<{ environmentId: string }>('environment.descriptor', {}, { environmentId: remoteEnvironmentId })
    expect(remote.environmentId).toBe(remoteEnvironmentId)
    await test.step('routed desktop session streams through the real relay and forwards takeover', async () => {
      const options = { environmentId: remoteEnvironmentId }
      const remoteProject = await one.rpc<{ projectId: string }>('project.open', { path: project }, options)
      const created = await a.window.evaluate(([connectionId, projectId]) => window.environment.createSession(connectionId, { projectId, providerId: 'claude-base', harnessId: 'claude', title: 'Routed phone acceptance' }), [remoteConnectionId, remoteProject.projectId])
      const remoteSessionId = created.sessionId
      const ref = { environmentId: remoteEnvironmentId, sessionId: remoteSessionId }
      await a.window.evaluate(([connectionId, sessionId]) => window.environment.sendSessionMessage(connectionId, { sessionId, text: '<scripted>[{"say":"ROUTED-WINDOW-TURN"}]</scripted>' }), [remoteConnectionId, remoteSessionId])
      const snapshot = await one.rpc<{ cursor: { sequence: string; epoch: string; version: number } }>('session.load', { sessionId: remoteSessionId }, options)
      console.log('[live] acquiring routed phone control after the window turn')
      await one.acquireControl(ref)
      await expect(two.acquireControl(ref)).rejects.toMatchObject({ code: 'failed_precondition' })
      await one.followSession({ session: ref, projectPath: project, cursor: snapshot.cursor })
      console.log('[live] sending routed phone turn')
      await one.controlledRpc(ref, 'session.send', { text: '<scripted>[{"say":"ROUTED-PHONE-TURN"}]</scripted>' })
      await expect.poll(() => JSON.stringify(events), { timeout: 30_000 }).toContain('ROUTED-PHONE-TURN')
      await b.window.evaluate(id => window.agent.disconnectRemoteSession(id), remoteSessionId)
      console.log('[live] checking source desktop takeover')
      await expect.poll(() => lost.includes(remoteSessionId), { timeout: 30_000 }).toBe(true)
      await expect(one.controlledRpc(ref, 'session.send', { text: 'retired routed proof' })).rejects.toMatchObject({ code: 'lease_required' })
      await one.stopSession()
    })
    await a.window.keyboard.press('Meta+Comma')
    await a.window.getByRole('button', { name: 'Remote Control', exact: true }).click()
    await expect(a.window.getByText('Protocol phone 0', { exact: true })).toBeVisible()
    await expect(a.window.getByText('Protocol phone 1', { exact: true })).toBeVisible()
    await a.window.screenshot({ path: `/tmp/unified-protocol-live-${route}-a.png` })
    await a.window.keyboard.press('Meta+Comma')
    await b.window.keyboard.press('Meta+Comma')
    await b.window.getByRole('button', { name: 'Remote Control', exact: true }).click()
    await b.window.getByRole('tab', { name: 'Control This Mac', exact: true }).click()
    await b.window.screenshot({ path: `/tmp/unified-protocol-live-${route}-b.png` })
    await b.window.keyboard.press('Meta+Comma')
  })
}

test('phone link changes LAN to relay during a real turn without reloading either desktop', async () => {
  const events: unknown[] = []
  const client = await connect(0, 'lan', [], events)
  const sessionId = await a.window.evaluate(path => window.agent.createSession(path), project)
  await a.window.evaluate(([path, id, content]) => window.agent.sendMessage(path, { sessionId: id, content }), [project, sessionId, scripted([{ say: 'BEFORE-FAILOVER' }, { sleep: 8_000 }, { say: 'AFTER-FAILOVER' }])])
  await expect.poll(async () => client.rpc('session.load', { sessionId }).then(() => true, () => false)).toBe(true)
  const ref = { environmentId: client.environmentId!, sessionId }
  const load = await client.rpc<{ cursor: { sequence: string; epoch: string; version: number } }>('session.load', { sessionId })
  await client.followSession({ session: ref, projectPath: project, cursor: load.cursor })
  await client.connectRelay({ relayUrl: pairings[0].relayUrl, link: pairings[0], deviceId: 'protocol-live-phone-0' })
  await client.verifyHost()
  expect(client.transport).toBe('relay')
  const realigned = await client.rpc<{ cursor: { sequence: string; epoch: string; version: number }; messages: unknown[] }>('session.load', { sessionId })
  expect(JSON.stringify(realigned.messages)).toContain('BEFORE-FAILOVER')
  await client.followSession({ session: ref, projectPath: project, cursor: realigned.cursor })
  await expect.poll(() => JSON.stringify(events), { timeout: 30_000 }).toContain('AFTER-FAILOVER')
})
