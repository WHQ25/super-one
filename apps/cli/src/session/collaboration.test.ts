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
  return { db, sessions, collab, projects, nodeHome, sessionProviders }
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
})
