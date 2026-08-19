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
import {
  CollaborationService,
  collaborationSystemPrompt,
  deriveCollaborationName,
  deriveCollaborationRole,
} from './collaboration'
import { createSessionProviderStore } from '@superone/runtime/session'
import { createHash } from 'node:crypto'

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function bootCollab() {
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
  const providers = new ProviderStore(db, join(nodeHome, 'secrets', 'provider.key'))
  const projects = new ProjectRegistry(db)
  const workspaceGit = new WorkspaceGitService(projects)
  const secrets = {
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => (v.startsWith('enc:') ? v.slice(4) : v),
  }
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
    secrets,
    sessionProviders,
  })
  return { db, sessions, collab, projects, providers, nodeHome, sessionProviders }
}

describe('collaboration helpers', () => {
  it('deriveCollaborationRole prefers explicit role then launchId', () => {
    expect(deriveCollaborationRole({ role: 'Reviewer', task: 'x' })).toBe('Reviewer')
    expect(deriveCollaborationRole({ launchId: 'diff-bot', task: 'x' })).toBe('diff-bot')
    expect(deriveCollaborationRole({ task: 'You are a tester' })).toBe('a tester')
  })

  it('deriveCollaborationName prefers explicit name', () => {
    expect(deriveCollaborationName({ name: 'Alice' })).toBe('Alice')
    expect(deriveCollaborationName({ launchId: 'bot-1' })).toBe('bot-1')
  })

  it('collaborationSystemPrompt embeds credential and parent id', () => {
    const prompt = collaborationSystemPrompt('s1sc_secret', 'parent-1')
    expect(prompt).toContain('parent-1')
    expect(prompt).toContain('s1sc_secret')
    expect(prompt).toContain('session_collab_send')
  })
})

describe('collaboration grants + mailbox', () => {
  it('listProfiles returns session_providers base profiles when catalog is empty', () => {
    const { collab } = bootCollab()
    // openNodeDatabase seeds claude-base / codex-base / … via session_providers.
    const profiles = collab.listProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.some((p) => p.id === 'claude-base' || p.id === 'claude')).toBe(true)
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
          task: 'Do the work',
          name: 'Worker',
          role: 'Implementer',
          config: { cwd: projectDir },
        },
      ],
    })
    expect(req.status).toBe('approved')
    if (req.status !== 'approved') throw new Error('expected approved')
    const { credential, grantId } = req.launches[0]
    expect(hashCredential(credential)).toBe(grantId)

    const row = db
      .prepare(`SELECT * FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantId) as { task: string; child_session_id: string | null; credential_secret: string }
    expect(row.task).toBe('Do the work')
    expect(row.child_session_id).toBeNull()
    expect(row.credential_secret).toContain(credential)

    const started = await collab.start({ credential })
    expect(started.reused).toBe(false)
    expect(started.sessionId).toBeTruthy()
    expect(sessions.getSystemPromptAppend(started.sessionId)).toContain(credential)

    // grantId-only start requires parent binding (no bearer credential).
    await expect(collab.start({ grantId })).rejects.toThrow(/callerSessionId|parent/i)
    const again = await collab.start({ grantId, callerSessionId: parent.sessionId })
    expect(again.reused).toBe(true)
    expect(again.sessionId).toBe(started.sessionId)

    // launch.config must not elevate permissionMode via request spread
    const escalated = await collab.request({
      parentSessionId: parent.sessionId,
      launches: [
        {
          agentId: 'claude',
          task: 'escalate',
          name: 'E',
          role: 'R',
          config: {
            cwd: projectDir,
            permissionMode: 'bypassPermissions',
            sandboxMode: 'danger-full-access',
          },
        },
      ],
    })
    if (escalated.status !== 'approved') throw new Error('expected approved')
    const escalatedStarted = await collab.start({
      credential: escalated.launches[0].credential,
    })
    const child = sessions.get(escalatedStarted.sessionId)
    expect(child?.permissionMode === 'bypassPermissions').toBe(false)
    expect(escalatedStarted.config.permissionMode).toBe('default')
    expect(escalatedStarted.config.sandboxMode).toBe('off')

    const sent = collab.send({
      credential,
      sessionId: parent.sessionId,
      content: 'hello child',
      clientMessageId: 'c1',
    })
    expect(sent.reused).toBe(false)
    expect(sent.sequence).toBe(1)

    const sentDup = collab.send({
      credential,
      sessionId: parent.sessionId,
      content: 'hello child',
      clientMessageId: 'c1',
    })
    expect(sentDup.reused).toBe(true)
    expect(sentDup.messageId).toBe(sent.messageId)

    const retrieved = collab.retrieve({
      credential,
      sessionId: started.sessionId,
      max: 5,
    })
    expect(retrieved.status).toBe('messages')
    expect(retrieved.messages).toHaveLength(1)
    expect(retrieved.messages[0].content).toBe('hello child')

    const empty = collab.retrieve({ credential, sessionId: started.sessionId })
    expect(empty.status).toBe('empty')

    // Cursor row persisted.
    const cursor = db
      .prepare(
        `SELECT last_sequence FROM session_collaboration_cursors
         WHERE credential_hash = ? AND session_id = ?`,
      )
      .get(grantId, started.sessionId) as { last_sequence: number }
    expect(cursor.last_sequence).toBe(1)
  })

  it('rejects send from a session that is not an endpoint of the grant', async () => {
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
          task: 't',
          name: 'A',
          role: 'R',
          config: { cwd: projectDir },
        },
      ],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    await collab.start({ credential: req.launches[0].credential })
    expect(() =>
      collab.send({
        credential: req.launches[0].credential,
        sessionId: stranger.sessionId,
        content: 'nope',
      }),
    ).toThrow(/does not authorize/)
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
          task: 'Please confirm the API shape.',
        },
      ],
    })
    expect(req.status).toBe('approved')
    if (req.status !== 'approved') throw new Error('expected approved')
    const grant = req.launches[0]
    expect(grant.mode).toBe('link')
    expect(grant.peerSessionId).toBe(peer.sessionId)

    // Peer is already bound at approve; no system prompt yet or after start.
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    expect(() =>
      collab.send({
        credential: grant.credential,
        sessionId: parent.sessionId,
        content: 'too early',
      }),
    ).toThrow(/not been started/i)

    const linked = await collab.start({ credential: grant.credential })
    expect(linked.status).toBe('linked')
    expect(linked.mode).toBe('link')
    expect(linked.sessionId).toBe(peer.sessionId)
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    collab.rehydrateSystemPrompts()
    expect(sessions.getSystemPromptAppend(peer.sessionId)).toBeUndefined()

    const row = db
      .prepare(`SELECT kind, started_at FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grant.grantId) as { kind: string; started_at: string | null }
    expect(row.kind).toBe('link')
    expect(row.started_at).toBeTruthy()

    const sent = collab.send({
      credential: grant.credential,
      sessionId: parent.sessionId,
      content: 'hello peer',
    })
    expect(sent.status).toBe('sent')

    const retrieved = collab.retrieve({
      credential: grant.credential,
      sessionId: peer.sessionId,
    })
    expect(retrieved.status).toBe('messages')
    expect(retrieved.messages.some((m) => m.content.includes('hello peer') || m.content.includes('API shape'))).toBe(true)
  })

  /**
   * Remote-node parity for handoff. Without it a remote session's handoff would
   * silently fall back to spawn — a nested, credential-bearing child.
   */
  it('handoff creates a sibling session with no credential, no endpoint row, no mailbox', async () => {
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
          task: 'Finish phase 2.',
          name: 'Dana',
          role: 'Implementer',
          config: { cwd: projectDir },
        },
      ],
    })
    if (req.status !== 'approved') throw new Error('expected approved')
    const grant = req.launches[0]
    expect(grant.mode).toBe('handoff')

    const started = await collab.start({ credential: grant.credential })
    expect(started).toMatchObject({ status: 'started', mode: 'handoff', reused: false })
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBeUndefined()
    collab.rehydrateSystemPrompts()
    expect(sessions.getSystemPromptAppend(started.sessionId)).toBeUndefined()

    // Sibling, not endpoint: child_session_id stays free so parent→child queries
    // skip it and it can still be linked/spawned against later.
    const row = db
      .prepare(`SELECT kind, child_session_id, config_json FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grant.grantId) as { kind: string; child_session_id: string | null; config_json: string }
    expect(row.kind).toBe('handoff')
    expect(row.child_session_id).toBeNull()
    expect(JSON.parse(row.config_json).handoffSessionId).toBe(started.sessionId)

    const again = await collab.start({ credential: grant.credential })
    expect(again).toMatchObject({ reused: true, sessionId: started.sessionId })

    expect(() =>
      collab.send({
        credential: grant.credential,
        sessionId: parent.sessionId,
        content: 'follow-up?',
      }),
    ).toThrow(/one-way/i)
    expect(() =>
      collab.retrieve({ credential: grant.credential, sessionId: started.sessionId }),
    ).toThrow(/one-way/i)

    // The grant is not FK-linked to the sibling, so a retry after deletion is reachable.
    sessions.remove(started.sessionId)
    await expect(collab.start({ credential: grant.credential })).rejects.toThrow(/no longer exists/i)
  })
})
