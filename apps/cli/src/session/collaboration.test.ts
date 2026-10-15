import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { agentProfilePrompt } from '@superone/shared/agent-profile'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime } from './session-runtime'
import { HarnessManager } from './harness-manager'
import { ProviderStore } from '../provider/provider-store'
import { ProjectRegistry } from '../workspace/project-registry'
import { WorkspaceGitService } from '@superone/runtime/workspace/git-service'
import { CollaborationService } from './collaboration'
import { createSessionProviderStore, type TurnRunner } from '@superone/runtime/session'
import type { NodeDatabase } from '../db/database'

function grantIdFor(db: NodeDatabase, launchId: string): string {
  const row = db
    .prepare(`SELECT credential_hash FROM session_collaboration_grants WHERE json_extract(config_json, '$.launchId') = ?`)
    .get(launchId) as { credential_hash: string }
  return row.credential_hash
}

const dirs: string[] = []
const collaborations: CollaborationService[] = []

afterEach(() => {
  for (const collab of collaborations.splice(0)) collab.dispose()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function bootCollab(opts?: { simulateReady?: boolean; turnRunner?: TurnRunner }) {
  const nodeHome = mkdtempSync(join(tmpdir(), 'collab-unit-'))
  dirs.push(nodeHome)
  const db = openNodeDatabase(join(nodeHome, 'state.sqlite'))
  const environmentId = 'env-test'
  const events = new EventLog(db, environmentId)
  const leases = new ControlLeaseService(db)
  const sessions = new SessionRuntime(db, events, leases, environmentId, opts?.turnRunner ?? (async ({ onDelta }) => {
    onDelta('ok')
    return { finalText: 'ok' }
  }))
  const harnesses = new HarnessManager(db)
  // listProfiles only offers agents this node can actually launch (same gate as
  // session.create). Without this the catalog is all-disabled and there are no
  // agents to collaborate with.
  if (opts?.simulateReady !== false) harnesses.enableSimulatedOverlay()
  const providers = new ProviderStore(db, join(nodeHome, 'secrets', 'provider.key'))
  const projects = new ProjectRegistry(db)
  const workspaceGit = new WorkspaceGitService(projects)
  const sessionProviders = createSessionProviderStore(db)
  const deps = {
    db,
    events,
    environmentId,
    sessions,
    harnesses,
    providers,
    projects,
    workspaceGit,
    sessionProviders,
  }
  const collab = new CollaborationService(deps)
  collaborations.push(collab)
  return { db, sessions, collab, projects, providers, nodeHome, sessionProviders, harnesses, events, deps, leases }
}

describe('collaboration grants + mailbox', () => {
  it('listProfiles returns session_providers base profiles when catalog is empty', () => {
    const { collab } = bootCollab()
    // openNodeDatabase seeds claude-base / codex-base / … via session_providers.
    const profiles = collab.listProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.some((p) => p.id === 'claude-base')).toBe(true)
  })

  // Desktop parity: the @codex popup is built from these ids, so a gap here is
  // an agent the user can name on desktop but not on a node.
  it('covers every harness the node can launch, cursor and dsh included', () => {
    const { collab } = bootCollab()
    const ids = collab.listProfiles().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining(['claude-base', 'codex-base', 'opencode-base', 'cursor-base', 'dsh-base']),
    )
  })

  it('omits a harness this node cannot launch, matching session.create', () => {
    const { collab, harnesses } = bootCollab({ simulateReady: false })
    expect(collab.listProfiles()).toEqual([])
    harnesses.update('codex', { enabled: true, state: 'ready' })
    expect(collab.listProfiles().map((p) => p.id)).toEqual(['codex-base'])
  })

  it('names the ACP row after the agent behind it, not the protocol', () => {
    const { collab } = bootCollab()
    const acp = collab.listProfiles().find((p) => p.id === 'acp-base')
    expect(acp).toMatchObject({
      harnessId: 'acp',
      acpAgentId: 'grok-build',
      brandKey: 'acp-grok',
      name: 'Grok',
    })
  })

  // The bare `claude` alias row used to be listed next to `claude-base`, which
  // duplicated every agent in the @-mention popup. It is still ACCEPTED as an
  // agentId (see the grants test below, which launches with agentId 'claude').
  it('lists one row per agent, not a duplicate under the bare harness id', () => {
    const { collab } = bootCollab()
    expect(collab.listProfiles().filter((p) => p.harnessId === 'claude').map((p) => p.id))
      .toEqual(['claude-base'])
  })

  it('listProfiles exposes third-party API providers for claude and codex', () => {
    const { collab, providers } = bootCollab()
    const openai = providers.createCredential({
      platformId: 'openai',
      planId: 'api',
      name: 'work-key',
      secret: 'sk-test-openai-abcdef',
    })
    const anthropic = providers.createCredential({
      platformId: 'anthropic',
      planId: 'api',
      name: 'claude-key',
      secret: 'sk-ant-test-abcdef',
    })

    const profiles = collab.listProfiles()
    const claude = profiles.find((p) => p.harnessId === 'claude')
    const codex = profiles.find((p) => p.harnessId === 'codex')
    expect(claude).toBeTruthy()
    expect(codex).toBeTruthy()

    expect(claude!.apiProviders.some((p) => p.id === anthropic.id)).toBe(true)
    expect(claude!.apiProviders.find((p) => p.id === anthropic.id)).toMatchObject({
      name: expect.any(String),
      keyName: 'claude-key',
    })
    // OpenAI keys serve codex (and often claude via proxy) — at least codex must list them.
    expect(codex!.apiProviders.some((p) => p.id === openai.id)).toBe(true)
    expect(codex!.apiProviders.find((p) => p.id === openai.id)).toMatchObject({
      keyName: 'work-key',
      brand: 'openai',
    })
  })

  it('offers an agent profile with its own name, description and defaults, and launches it with its instructions', async () => {
    const { collab, sessions, projects, sessionProviders } = bootCollab()
    const reviewer = sessionProviders.profiles.create({
      harnessId: 'claude',
      name: 'Reviewer',
      config: {
        profile: {
          version: 1,
          identity: { name: 'Reviewer', description: 'Reviews diffs without editing.' },
          instructions: 'Never edit files.',
          runtime: { effort: 'low' },
        },
      },
    })
    const listed = collab.listProfiles().find((p) => p.id === reviewer.id)
    expect(listed).toMatchObject({ name: 'Reviewer', description: 'Reviews diffs without editing.' })

    const projectDir = mkdtempSync(join(tmpdir(), 'collab-proj-'))
    dirs.push(projectDir)
    const project = projects.open(projectDir)
    const parent = sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'parent' })
    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [{ agentId: reviewer.id, name: 'Rex', role: 'Reviewer', summary: 'Review.', config: { cwd: projectDir } }],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const started = await collab.start({ callerSessionId: parent.sessionId, launchId: req.launches[0].launchId, task: 'Review it' })
    const append = sessions.getSystemPromptAppend(started.sessionId) ?? ''
    expect(append.startsWith(`${agentProfilePrompt({
      version: 1,
      identity: { name: 'Reviewer', description: 'Reviews diffs without editing.' },
      instructions: 'Never edit files.',
    })}\n\n`)).toBe(true)
    expect(append).toContain(parent.sessionId)
  })

  it('starts a profile launch with the options this node applies, and drops the rest', async () => {
    const { collab, sessions, projects, sessionProviders } = bootCollab()
    const identity = { name: 'Planner', description: 'Plans first.' }
    const planner = sessionProviders.profiles.create({
      harnessId: 'opencode', name: 'Planner', config: { profile: { version: 1, identity, runtime: { options: { agent: 'plan' } } } },
    })
    const ultra = sessionProviders.profiles.create({
      harnessId: 'claude', name: 'Ultra', config: { profile: { version: 1, identity: { ...identity, name: 'Ultra' }, runtime: { model: 'claude-opus-5-5', options: { ultracode: true } } } },
    })
    expect(collab.listProfiles().find((p) => p.id === ultra.id)?.defaultConfig).toEqual({ model: 'claude-opus-5-5', effort: 'high' })

    const projectDir = mkdtempSync(join(tmpdir(), 'collab-options-'))
    dirs.push(projectDir)
    const parent = sessions.create({ projectId: projects.open(projectDir).projectId, harnessId: 'claude', title: 'parent' })
    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [{ agentId: planner.id, name: 'Pat', role: 'Planner', summary: 'Plan.', config: { cwd: projectDir } }],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const started = await collab.start({ callerSessionId: parent.sessionId, launchId: req.launches[0].launchId, task: 'Plan it' })
    expect(sessions.get(started.sessionId)?.agent).toBe('plan')
  })

  it('keeps the model and effort defaults of a row written before profiles', () => {
    const { collab, sessionProviders } = bootCollab()
    const legacy = sessionProviders.create({ harnessId: 'claude', name: 'Legacy', config: { model: 'claude-sonnet-5-5', effort: 'low' } })
    expect(collab.listProfiles().find((p) => p.id === legacy.id)?.defaultConfig).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' })
  })

  it('rejects an explicit launch effort the chosen model cannot carry', async () => {
    const { collab, sessions, projects } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-effort-'))
    dirs.push(projectDir)
    const parent = sessions.create({ projectId: projects.open(projectDir).projectId, harnessId: 'claude', title: 'parent' })
    await expect(collab.request({
      parentSessionId: parent.sessionId,
      launches: [{ agentId: 'claude-base', name: 'Rex', role: 'Reviewer', summary: 'Review.', config: { model: 'claude-sonnet-5-5', effort: 'ultra' } }],
    })).rejects.toThrow(/config\.effort "ultra" is not supported by Claude model "claude-sonnet-5-5"/)
  })

  it('restores a profile handoff session\'s instructions after restart, from the current row', async () => {
    const { collab, sessions, projects, sessionProviders } = bootCollab()
    const spec = (instructions: string) => ({ version: 1 as const, identity: { name: 'Finisher', description: 'Finishes migrations.' }, instructions })
    const profile = (instructions: string) => ({ profile: spec(instructions) })
    const finisher = sessionProviders.profiles.create({ harnessId: 'claude', name: 'Finisher', config: profile('Never edit files.') })
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-handoff-profile-'))
    dirs.push(projectDir)
    const parent = sessions.create({ projectId: projects.open(projectDir).projectId, harnessId: 'claude', title: 'parent' })
    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [{ mode: 'handoff', agentId: finisher.id, name: 'Dana', role: 'Implementer', summary: 'Summary.', config: { cwd: projectDir } }],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const start = () => collab.start({ callerSessionId: parent.sessionId, launchId: req.launches[0].launchId, task: 'Finish it.' })
    const started = await start()
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBe(agentProfilePrompt(spec('Never edit files.')))

    // A restart loses the in-memory append; rehydrate rebuilds it without the collaboration protocol.
    sessions.setSystemPromptAppend(started.sessionId, undefined)
    collab.rehydrateSystemPrompts()
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBe(agentProfilePrompt(spec('Never edit files.')))

    sessionProviders.profiles.update(finisher.id, { config: profile('Review only.') }, sessionProviders.get(finisher.id)!)
    sessions.setSystemPromptAppend(started.sessionId, undefined)
    expect(await start()).toMatchObject({ reused: true })
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBe(agentProfilePrompt(spec('Review only.')))
  })

  it('request creates durable grants; start is idempotent; send/retrieve advance cursor', async () => {
    const { collab, sessions, projects, db } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-proj-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'parent',
    })

    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          name: 'Worker',
          role: 'Implementer',
          summary: 'Do the work.',
          config: { cwd: projectDir },
        },
      ],
    })
    expect(req.status).toBe('approved')
    if (req.status !== 'approved') throw new Error('expected approved')
    const { launchId } = req.launches[0]
    expect(req.next).toMatch(/session_collab_start/)
    const grantId = grantIdFor(db, launchId)
    const taskOf = () => (db
      .prepare(`SELECT task, child_session_id, credential_secret FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantId) as { task: string; child_session_id: string | null; credential_secret: string | null })
    // The brief arrives at start, not at request; no secret is stored.
    expect(taskOf()).toEqual({ task: '', child_session_id: null, credential_secret: null })

    await expect(collab.start({ callerSessionId: parent.sessionId, launchId }))
      .rejects.toThrow(/requires a non-empty task/)
    const started = await collab.start({ callerSessionId: parent.sessionId, launchId, task: 'Do the work' })
    expect(started.reused).toBe(false)
    expect(started.sessionId).toBeTruthy()
    expect(taskOf().task).toBe('Do the work')
    expect(sessions.getSystemPromptAppend(started.sessionId)).toContain(parent.sessionId)
    // The brief reads as a task from the parent session, as on the desktop.
    expect(sessions.listMessages({ sessionId: started.sessionId }).messages[0]).toMatchObject({
      role: 'user',
      metadata: { source: 'collaboration', collaboration: { kind: 'initial_task', fromSessionTitle: 'parent' } },
    })

    // launchIds are scoped to the requesting session.
    await expect(collab.start({ callerSessionId: started.sessionId, launchId, task: 'x' }))
      .rejects.toThrow(/No approved launch/)
    const again = await collab.start({ callerSessionId: parent.sessionId, launchId, task: 'Different brief' })
    expect(again.reused).toBe(true)
    expect(again.sessionId).toBe(started.sessionId)
    expect(taskOf().task).toBe('Do the work')

    // launch.config must not elevate permissionMode via request spread
    const escalated = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          name: 'E',
          role: 'R',
          summary: 'Summary.',
          config: {
            cwd: projectDir,
            permissionMode: 'bypassPermissions',
            sandboxMode: 'off',
          },
        },
      ],
    })
    if (escalated.status !== 'approved') throw new Error('expected approved')
    const escalatedStarted = await collab.start({
      callerSessionId: parent.sessionId,
      launchId: escalated.launches[0].launchId,
      task: 'escalate',
    })
    const child = sessions.get(escalatedStarted.sessionId)
    expect(child?.permissionMode === 'bypassPermissions').toBe(false)
    expect(escalatedStarted.config.permissionMode).toBe('default')
    expect(escalatedStarted.config.sandboxMode).toBe('off')

    const sent = collab.send({
      sessionId: parent.sessionId,
      to: started.sessionId,
      content: 'hello child',
      clientMessageId: 'c1',
    })
    expect(sent.reused).toBe(false)
    expect(sent.to).toMatchObject({ sessionId: started.sessionId, relation: 'child' })
    expect(sent.sequence).toBe(1)

    const sentDup = collab.send({
      sessionId: parent.sessionId,
      to: started.sessionId,
      content: 'hello child',
      clientMessageId: 'c1',
    })
    expect(sentDup.reused).toBe(true)
    expect(sentDup.messageId).toBe(sent.messageId)
    expect(db.prepare('SELECT state, attempts FROM collaboration_wakes WHERE notification_id = ?')
      .get(`collab-message:${sent.messageId}`)).toMatchObject({ state: 'queued', attempts: 0 })
    expect(db.prepare('SELECT notification_id FROM collaboration_wakes WHERE notification_id = ?')
      .all(`collab-message:${sent.messageId}`)).toHaveLength(1)

    const retrieved = collab.retrieve({
      sessionId: started.sessionId,
      max: 5,
    })
    expect(retrieved.status).toBe('messages')
    expect(retrieved.messages).toHaveLength(1)
    expect(retrieved.messages[0].content).toBe('hello child')
    expect(retrieved.messages[0].from).toMatchObject({ sessionId: parent.sessionId, relation: 'parent' })

    const empty = collab.retrieve({ sessionId: started.sessionId })
    expect(empty.status).toBe('empty')
    expect(empty.peers).toEqual([expect.objectContaining({ sessionId: parent.sessionId, relation: 'parent' })])

    // Cursor row persisted.
    const cursor = db
      .prepare(
        `SELECT last_sequence FROM session_collaboration_cursors
         WHERE credential_hash = ? AND session_id = ?`,
      )
      .get(grantId, started.sessionId) as { last_sequence: number }
    expect(cursor.last_sequence).toBe(1)
  })

  it('keeps new mail queued after a native turn error and resumes only on confirmed completion', async () => {
    const { collab, sessions, projects, db, events, nodeHome } = bootCollab()
    const project = projects.open(nodeHome)
    const parent = sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'parent' })
    const peer = sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'peer' })
    const request = await collab.request({ parentSessionId: parent.sessionId,
      launches: [{ mode: 'link', sessionId: peer.sessionId, summary: 'Sync' }] })
    if (request.status !== 'approved') throw new Error('expected approval')
    await collab.start({ callerSessionId: parent.sessionId, launchId: request.launches[0].launchId })
    await vi.waitFor(() => expect(db.prepare("SELECT state FROM collaboration_wakes WHERE notification_id LIKE 'collab-link:%'").get())
      .toMatchObject({ state: 'admitted' }))
    events.appendSession({ sessionId: peer.sessionId, eventType: SESSION_DURABLE_EVENT.turnError, payload: { message: 'unavailable' } })
    const sent = collab.send({ sessionId: parent.sessionId, to: peer.sessionId, content: 'pending update' })
    const state = () => db.prepare('SELECT state, attempts FROM collaboration_wakes WHERE notification_id = ?').get(`collab-message:${sent.messageId}`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state()).toMatchObject({ state: 'queued', attempts: 0 })
    events.appendSession({ sessionId: peer.sessionId, eventType: SESSION_DURABLE_EVENT.statusChanged, payload: { status: 'idle' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state()).toMatchObject({ state: 'queued', attempts: 0 })
    events.appendSession({ sessionId: peer.sessionId, eventType: SESSION_DURABLE_EVENT.turnCompleted, payload: { status: 'idle' } })
    await vi.waitFor(() => expect(state()).toMatchObject({ state: 'admitted', attempts: 1 }))
  })

  it.each([false, true])('tracks CLI input acceptance before a harness failure (accepted=%s)', async (accepted) => {
    let input!: Parameters<TurnRunner>[0]
    let fail!: (error: Error) => void
    const { collab, sessions, projects, nodeHome, db, events } = bootCollab({
      turnRunner: async (args) => { input = args; return new Promise((_resolve, reject) => { fail = reject }) },
    })
    const project = projects.open(nodeHome)
    const parent = sessions.create({ projectId: project.projectId, harnessId: 'claude' })
    const child = sessions.create({ projectId: project.projectId, harnessId: 'claude' })
    const request = await collab.request({ parentSessionId: parent.sessionId,
      launches: [{ mode: 'link', sessionId: child.sessionId, summary: 'Sync' }] })
    if (request.status !== 'approved') throw new Error('expected approval')
    await collab.start({ callerSessionId: parent.sessionId, launchId: request.launches[0].launchId })
    await vi.waitFor(() => expect(input).toBeDefined())
    const row = () => db.prepare('SELECT state, last_error FROM collaboration_wakes').get()
    expect(row()).not.toMatchObject({ state: 'admitted' })
    if (accepted) {
      events.appendSession({ sessionId: child.sessionId, eventType: SESSION_DURABLE_EVENT.turnInterrupted,
        payload: { reason: 'client_interrupt' } })
      expect(() => input.onInputAccepted?.()).not.toThrow()
      expect(row()).toMatchObject({ state: 'admitted' })
    }
    fail(new Error('harness spawn failed'))
    await vi.waitFor(() => expect(sessions.get(child.sessionId)?.status).toBe('error'))
    await vi.waitFor(() => expect(row()).toMatchObject(accepted
      ? { state: 'admitted', last_error: null } : { state: 'queued', last_error: 'harness spawn failed' }))
    expect(sessions.get(child.sessionId)?.transcript).toHaveLength(0)
  })

  it.each(['node_restart', 'client_interrupt'] as const)('restores notification admission according to persisted %s provenance', async (reason) => {
    const first = bootCollab({ turnRunner: async ({ signal, onInputAccepted }) => new Promise((resolve) => {
      onInputAccepted?.()
      signal.addEventListener('abort', () => resolve({ finalText: '' }), { once: true })
    }) })
    const { db, sessions, projects, collab, nodeHome, deps } = first
    const project = projects.open(nodeHome)
    const parent = sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'parent' })
    const child = sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'child' })
    const request = await collab.request({ parentSessionId: parent.sessionId,
      launches: [{ mode: 'link', sessionId: child.sessionId, summary: 'Sync' }] })
    if (request.status !== 'approved') throw new Error('expected approval')
    await collab.start({ callerSessionId: parent.sessionId, launchId: request.launches[0].launchId })
    await vi.waitFor(() => expect(db.prepare("SELECT state FROM collaboration_wakes WHERE notification_id LIKE 'collab-link:%'").get())
      .toMatchObject({ state: 'admitted' }))
    expect(sessions.get(child.sessionId)?.status).toBe('streaming')
    collab.dispose()
    if (reason === 'client_interrupt') {
      // Stop while collaboration is offline, so startup must use the durable
      // reason rather than a pause observed by a running service.
      const lease = first.leases.acquire({ resource: { environmentId: deps.environmentId, sessionId: child.sessionId },
        holderClientId: 'client', ttlMs: 30_000 })
      sessions.interrupt(child.sessionId, { clientSessionId: 'client' }, lease.leaseId, lease.generation)
      await vi.waitFor(() => expect(db.prepare(`SELECT payload_json FROM environment_events
        WHERE aggregate_id = ? AND event_type = ? ORDER BY sequence DESC LIMIT 1`)
        .get(child.sessionId, SESSION_DURABLE_EVENT.turnInterrupted)).toMatchObject({ payload_json: expect.stringContaining('client_interrupt') }))
    }
    const events = new EventLog(db, deps.environmentId)
    const restartedSessions = new SessionRuntime(db, events, new ControlLeaseService(db), deps.environmentId,
      async ({ onDelta }) => { onDelta('resumed'); return { finalText: 'resumed' } })
    expect(restartedSessions.get(child.sessionId)?.status).toBe('interrupted')
    const restarted = new CollaborationService({ ...deps, events, sessions: restartedSessions })
    collaborations.push(restarted)
    const sent = restarted.send({ sessionId: parent.sessionId, to: child.sessionId, content: 'continue with this new input' })
    const row = () => db.prepare('SELECT state, attempts FROM collaboration_wakes WHERE notification_id = ?')
      .get(`collab-message:${sent.messageId}`)
    if (reason === 'node_restart') await vi.waitFor(() => expect(row()).toMatchObject({ state: 'admitted' }))
    else {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(row()).toMatchObject({ state: 'queued', attempts: 0 })
    }
  })

  it('rejects send to a session that is not a collaboration peer', async () => {
    const { collab, sessions, projects } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-proj2-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({ projectId: project.projectId, harnessId: 'claude' })
    const stranger = sessions.create({ projectId: project.projectId, harnessId: 'claude' })
    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          name: 'A',
          role: 'R',
          summary: 'Summary.',
          config: { cwd: projectDir },
        },
      ],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const child = await collab.start({ callerSessionId: parent.sessionId, launchId: req.launches[0].launchId, task: 't' })
    expect(() =>
      collab.send({
        sessionId: stranger.sessionId,
        to: child.sessionId,
        content: 'nope',
      }),
    ).toThrow(/not one of your collaboration peers/)
    expect(() => collab.retrieve({ sessionId: stranger.sessionId, from: [parent.sessionId] }))
      .toThrow(/Not your collaboration peers/)
  })

  it('link mode binds an existing peer without system-prompt injection', async () => {
    const { collab, sessions, projects, db } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-link-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'initiator',
    })
    const peer = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'existing peer',
    })

    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          mode: 'link',
          sessionId: peer.sessionId,
          summary: 'Sync with existing peer',
        },
      ],
    })
    expect(req.status).toBe('approved')
    if (req.status !== 'approved') throw new Error('expected approved')
    const grant = req.launches[0]
    expect(grant.mode).toBe('link')
    expect(grant.sessionId).toBe(peer.sessionId)

    // Peer is already bound at approve; no system prompt yet or after start.
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    expect(() =>
      collab.send({
        sessionId: parent.sessionId,
        to: peer.sessionId,
        content: 'too early',
      }),
    ).toThrow(/not one of your collaboration peers/i)

    const linked = await collab.start({
      callerSessionId: parent.sessionId,
      launchId: grant.launchId,
      task: 'Please confirm the API shape.',
    })
    expect(linked.status).toBe('linked')
    expect(linked.mode).toBe('link')
    expect(linked.sessionId).toBe(peer.sessionId)
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    collab.rehydrateSystemPrompts()
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    const row = db
      .prepare(`SELECT kind, started_at FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantIdFor(db, grant.launchId)) as { kind: string; started_at: string | null }
    expect(row.kind).toBe('link')
    expect(row.started_at).toBeTruthy()

    const sent = collab.send({
      sessionId: parent.sessionId,
      to: peer.sessionId,
      content: 'hello peer',
    })
    expect(sent.status).toBe('sent')

    const retrieved = collab.retrieve({ sessionId: peer.sessionId })
    expect(retrieved.peers).toEqual([expect.objectContaining({ sessionId: parent.sessionId, relation: 'link' })])
    expect(retrieved.status).toBe('messages')
    expect(retrieved.messages.map((m) => m.content)).toEqual(['Please confirm the API shape.', 'hello peer'])
  })

  /**
   * Remote-node parity for handoff. Without it a remote session's handoff would
   * silently fall back to spawn — a nested child with a mailbox.
   */
  it('handoff creates a sibling session with no collaboration prompt, no endpoint row, no mailbox', async () => {
    const { collab, sessions, projects, db } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-handoff-'))
    dirs.push(projectDir)
    writeFileSync(join(projectDir, 'f'), '1')
    const project = projects.open(projectDir)
    const parent = sessions.create({
      projectId: project.projectId,
      harnessId: 'claude',
      title: 'Migration phase 1',
    })

    const req = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          mode: 'handoff',
          agentId: 'claude',
          name: 'Dana',
          role: 'Implementer',
          summary: 'Summary.',
          config: { cwd: projectDir },
        },
      ],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const grant = req.launches[0]
    expect(grant.mode).toBe('handoff')

    const start = () => collab.start({ callerSessionId: parent.sessionId, launchId: grant.launchId, task: 'Finish phase 2.' })
    const started = await start()
    expect(started).toMatchObject({ status: 'started', mode: 'handoff', reused: false })
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBeUndefined()
    collab.rehydrateSystemPrompts()
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBeUndefined()

    // Sibling, not endpoint: child_session_id stays free so parent→child queries
    // skip it and it can still be linked/spawned against later.
    const row = db
      .prepare(`SELECT kind, child_session_id, config_json FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantIdFor(db, grant.launchId)) as { kind: string; child_session_id: string | null; config_json: string }
    expect(row.kind).toBe('handoff')
    expect(row.child_session_id).toBeNull()
    expect(JSON.parse(row.config_json).handoffSessionId).toBe(started.sessionId)

    const again = await start()
    expect(again).toMatchObject({ reused: true, sessionId: started.sessionId })

    expect(() =>
      collab.send({
        sessionId: parent.sessionId,
        to: started.sessionId,
        content: 'follow-up?',
      }),
    ).toThrow(/one-way/i)
    expect(() => collab.send({ sessionId: started.sessionId, to: parent.sessionId, content: 'hi' }))
      .toThrow(/one-way/i)
    expect(collab.retrieve({ sessionId: started.sessionId }).peers).toEqual([])

    // The grant is not FK-linked to the sibling, so a retry after deletion is reachable.
    sessions.remove(started.sessionId)
    await expect(start()).rejects.toThrow(/no longer exists/i)
  })
})

describe('continuing a session in a new one', () => {
  async function spawnChild() {
    const booted = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-proj-'))
    dirs.push(projectDir)
    const project = booted.projects.open(projectDir)
    const parent = booted.sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'parent' })
    const req = await booted.collab.request({
      parentSessionId: parent.sessionId,
      launches: [{ agentId: 'claude', name: 'Worker', role: 'Implementer', summary: 'Do it.', config: { cwd: projectDir } }],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const child = await booted.collab.start({ callerSessionId: parent.sessionId, launchId: req.launches[0].launchId, task: 'Do it' })
    const create = () => booted.sessions.create({ projectId: project.projectId, harnessId: 'claude', title: 'next' })
    return { ...booted, parent, childId: child.sessionId, create }
  }

  it('moves a child\'s channel and prompt to its successor', async () => {
    const { collab, sessions, parent, childId, create } = await spawnChild()
    await vi.waitFor(() => expect(sessions.get(childId)?.status).not.toBe('streaming'))
    const successor = create()

    collab.assertContinuable(childId)
    collab.continueSession(childId, successor.sessionId)

    expect(sessions.getSystemPromptAppend(successor.sessionId)).toContain(parent.sessionId)
    expect(sessions.getSystemPromptAppend(childId)).toBeUndefined()
    // The parent still names the old child; the message reaches the successor.
    collab.send({ sessionId: parent.sessionId, to: childId, content: 'more work' })
    const read = collab.retrieve({ sessionId: successor.sessionId })
    expect(read.messages.map((message) => message.content)).toEqual(['more work'])
    expect(() => collab.assertContinuable(childId)).toThrow(/already continued/)
  })

  it('makes the successor the child of a parent on another machine', async () => {
    const { collab, sessions, projects } = bootCollab()
    const projectDir = mkdtempSync(join(tmpdir(), 'collab-proj-'))
    dirs.push(projectDir)
    const projectId = projects.open(projectDir).projectId
    const child = sessions.create({ projectId, harnessId: 'claude', externalParent: { sessionId: 'desktop-parent' } })
    const successor = sessions.create({ projectId, harnessId: 'claude' })

    collab.continueSession(child.sessionId, successor.sessionId)

    expect(sessions.get(successor.sessionId)?.externalParent).toEqual({ sessionId: 'desktop-parent' })
    expect(sessions.getSystemPromptAppend(successor.sessionId)).toContain('desktop-parent')
    expect(sessions.get(child.sessionId)?.externalParent).toBeNull()
    expect(sessions.getSystemPromptAppend(child.sessionId)).toBeUndefined()
  })

  it('refuses a session that no longer exists', async () => {
    const { collab } = await spawnChild()
    expect(() => collab.assertContinuable('missing')).toThrow(/no longer exists/)
  })
})
