import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase } from '../db/database'
import { EventLog } from './event-log'
import { ControlLeaseService } from './control-lease'
import { SessionRuntime } from './session-runtime'
import { HarnessManager } from './harness-manager'
import { ProviderStore } from '../provider/provider-store'
import { ProjectRegistry } from '../workspace/project-registry'
import { WorkspaceGitService } from '../workspace/git-service'
import { CollaborationService } from './collaboration'
import { createSessionProviderStore } from '@superone/runtime/session'
import type { NodeDatabase } from '../db/database'

function grantIdFor(db: NodeDatabase, launchId: string): string {
  const row = db
    .prepare(`SELECT credential_hash FROM session_collaboration_grants WHERE json_extract(config_json, '$.launchId') = ?`)
    .get(launchId) as { credential_hash: string }
  return row.credential_hash
}

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function bootCollab(opts?: { simulateReady?: boolean }) {
  const nodeHome = mkdtempSync(join(tmpdir(), 'collab-unit-'))
  dirs.push(nodeHome)
  const db = openNodeDatabase(join(nodeHome, 'state.sqlite'))
  const environmentId = 'env-test'
  const events = new EventLog(db, environmentId)
  const leases = new ControlLeaseService(db)
  const sessions = new SessionRuntime(db, events, leases, environmentId, async ({ onDelta }) => {
    onDelta('ok')
    return { finalText: 'ok' }
  })
  const harnesses = new HarnessManager(db)
  // listProfiles only offers agents this node can actually launch (same gate as
  // session.create). Without this the catalog is all-disabled and there are no
  // agents to collaborate with.
  if (opts?.simulateReady !== false) harnesses.enableSimulatedOverlay()
  const providers = new ProviderStore(db, join(nodeHome, 'secrets', 'provider.key'))
  const projects = new ProjectRegistry(db)
  const workspaceGit = new WorkspaceGitService(projects)
  const sessionProviders = createSessionProviderStore(db)
  const collab = new CollaborationService({
    db,
    events,
    environmentId,
    sessions,
    harnesses,
    providers,
    projects,
    workspaceGit,
    sessionProviders,
  })
  return { db, sessions, collab, projects, providers, nodeHome, sessionProviders, harnesses }
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
